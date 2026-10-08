import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Brackets, DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { EmployeeEntity } from '../../entities/employee.entity';
import { FeatureEntity } from '../../entities/feature.entity';
import { MerchantEntity } from '../../entities/merchant.entity';
import { MerchantRoleTemplateEntity } from '../../entities/merchant-role-template.entity';
import { PlanEntity } from '../../entities/plan.entity';
import { RoleTemplateEntity } from '../../entities/role-template.entity';
import { StoreEntity } from '../../entities/store.entity';
import { StoreTypeEntity } from '../../entities/store-type.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { VendorEntity } from '../../entities/vendor.entity';
import { MerchantRepository } from '../merchant/merchant.repository';
import { EmployeeFilterDTO } from './employee-filter.dto';
import { FeatureFilterDTO } from './feature-filter.dto';
import { RoleTemplateFilterDTO, RoleTemplateRecord } from './role-template-filter.dto';
import { StoreFilterDTO } from './store-filter.dto';
import { SubscriptionFilterDTO } from './subscription-filter.dto';
import { VendorFilterDTO } from './vendor-filter.dto';
import { ensureVendorStoreSchema } from './vendor-store.schema';

type ColumnRef = { name: string; type: string };

interface ResolvedStore {
  legacyId: string;
  uuid: string | null;
  merchantBusinessId: string;
  merchantUuid: string | null;
}

/**
 * One query builder per entity. Each optional filter adds a predicate or a
 * parent join. To support Devices or Tenders later:
 * 1. Add a filter DTO with optional parent ids.
 * 2. Copy getStores() when the parent id is a column on the entity.
 * 3. Copy the store_employees join when the parent is a many-to-many assignment.
 * Column names are read from TypeORM metadata, so snake_case and camelCase both work.
 */
@Injectable()
export class DynamicQueryRepository {
  private tableColumns = new Map<string, Map<string, string>>();
  private vendorStoresReady?: Promise<void>;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async getEmployees(filter: EmployeeFilterDTO): Promise<EmployeeEntity[]> {
    const qb = this.repo(EmployeeEntity).createQueryBuilder('employee');
    const merchantUuid = await this.optionalMerchantUuid(filter.merchantId);
    if (filter.merchantId && !merchantUuid) return [];
    if (merchantUuid) this.whereEqual(qb, 'merchantId', merchantUuid);
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());

    if (filter.storeId?.trim() || filter.roleId?.trim()) {
      const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
      if (filter.storeId?.trim() && !store) return [];
      const assignment = await this.requireColumn('store_employees', 'employee_id', 'employeeId');
      const storeColumn = await this.requireColumn('store_employees', 'store_id', 'storeId');
      qb.innerJoin(
        'store_employees',
        'assignment',
        `${this.ref('assignment', assignment.name)} = employee.id`,
      );
      qb.andWhere(`${this.ref('assignment', await this.statusColumn('store_employees'))} = :employeeAssignmentStatus`, {
        employeeAssignmentStatus: 'ACTIVE',
      });
      if (store) {
        const storeKey = this.storeKey(store, storeColumn);
        if (!storeKey) return [];
        qb.andWhere(`${this.ref('assignment', storeColumn.name)} = :employeeStoreId`, { employeeStoreId: storeKey });
      }
      if (filter.roleId?.trim()) {
        const link = await this.requireColumn('employee_store_roles', 'employee_store_id', 'employeeStoreId');
        const role = await this.requireColumn('employee_store_roles', 'role_id', 'roleId');
        qb.innerJoin(
          'employee_store_roles',
          'assignmentRole',
          `${this.ref('assignmentRole', link.name)} = assignment.id AND ${this.ref('assignmentRole', role.name)} = :roleId`,
          { roleId: filter.roleId.trim() },
        );
      }
      qb.distinct(true);
    }

    const employees = await qb.orderBy('employee.firstName', 'ASC').addOrderBy('employee.lastName', 'ASC').getMany();
    return this.omit(employees, ['loginPinHash', 'passwordHash']);
  }

  async getStores(filter: StoreFilterDTO): Promise<StoreEntity[]> {
    const qb = this.repo(StoreEntity).createQueryBuilder('store');
    const merchantId = await this.optionalMerchantBusinessId(filter.merchantId);
    if (filter.merchantId && !merchantId) return [];
    if (merchantId) this.whereEqual(qb, 'merchantId', merchantId);
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
    const location = filter.location?.trim();
    if (location) {
      const address = qb.expressionMap.mainAlias?.metadata.findColumnWithPropertyName('address');
      if (!address) throw new ServiceUnavailableException('Store address column is not mapped');
      const column = this.ref('store', address.databaseName);
      qb.andWhere(
        `(${column}->>'city' ILIKE :location OR ${column}->>'state' ILIKE :location OR ${column}->>'country' ILIKE :location OR ${column}->>'street' ILIKE :location)`,
        { location: `%${location}%` },
      );
    }
    const stores = await qb.orderBy('store.createdAt', 'DESC').getMany();
    return this.omit(stores, ['websiteConnector']);
  }

  async getVendors(filter: VendorFilterDTO): Promise<VendorEntity[]> {
    const qb = this.repo(VendorEntity).createQueryBuilder('vendor');
    const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
    if (filter.storeId?.trim() && !store) return [];

    let merchantUuid = await this.optionalMerchantUuid(filter.merchantId);
    if (filter.merchantId && !merchantUuid) return [];
    if (store?.merchantUuid && merchantUuid && store.merchantUuid !== merchantUuid) return [];
    merchantUuid = merchantUuid ?? store?.merchantUuid ?? null;

    if (merchantUuid) {
      const vendorId = await this.requireColumn('merchant_vendors', 'vendor_id', 'vendorId');
      const merchantId = await this.requireColumn('merchant_vendors', 'merchant_id', 'merchantId');
      qb.innerJoin(
        'merchant_vendors',
        'merchantVendor',
        `${this.ref('merchantVendor', vendorId.name)} = vendor.id AND ${this.ref('merchantVendor', merchantId.name)} = :vendorMerchantId AND ${this.ref('merchantVendor', await this.statusColumn('merchant_vendors'))} = :vendorAssignmentStatus`,
        { vendorMerchantId: merchantUuid, vendorAssignmentStatus: 'ACTIVE' },
      );
    }
    if (store) {
      await this.ensureVendorStores();
      const vendorId = await this.requireColumn('vendor_stores', 'vendor_id', 'vendorId');
      const storeId = await this.requireColumn('vendor_stores', 'store_id', 'storeId');
      const storeKey = this.storeKey(store, storeId);
      if (!storeKey) return [];
      qb.innerJoin(
        'vendor_stores',
        'vendorStore',
        `${this.ref('vendorStore', vendorId.name)} = vendor.id AND ${this.ref('vendorStore', storeId.name)} = :vendorStoreId AND ${this.ref('vendorStore', await this.statusColumn('vendor_stores'))} = :vendorStoreStatus`,
        { vendorStoreId: storeKey, vendorStoreStatus: 'ACTIVE' },
      );
    }
    if (filter.vendorType?.trim()) this.whereEqual(qb, 'vendorType', filter.vendorType.trim().toUpperCase());
    const category = filter.productCategory?.trim();
    if (category) this.whereContains(qb, 'productCategory', category);

    return qb.distinct(true).orderBy('vendor.vendorName', 'ASC').getMany();
  }

  async getSubscriptions(filter: SubscriptionFilterDTO): Promise<SubscriptionEntity[]> {
    const qb = this.repo(SubscriptionEntity).createQueryBuilder('subscription');
    const merchantId = await this.optionalMerchantBusinessId(filter.merchantId);
    if (filter.merchantId && !merchantId) return [];
    if (merchantId) this.whereEqual(qb, 'merchantId', merchantId);
    if (filter.planId?.trim()) this.whereEqual(qb, 'planId', filter.planId.trim());
    this.whereEqual(qb, 'status', (filter.status?.trim() || 'ACTIVE').toUpperCase());

    if (filter.storeId?.trim()) {
      const store = await this.resolveStore(filter.storeId);
      if (!store) return [];
      const subscriptionId = await this.requireColumn('subscription_stores', 'subscription_id', 'subscriptionId');
      const storeId = await this.requireColumn('subscription_stores', 'store_id', 'storeId');
      const storeKey = this.storeKey(store, storeId);
      if (!storeKey) return [];
      qb.andWhere(subquery => {
        const link = subquery.subQuery()
          .select('1')
          .from('subscription_stores', 'subscriptionStore')
          .where(`${this.ref('subscriptionStore', subscriptionId.name)} = subscription.id`)
          .andWhere(`${this.ref('subscriptionStore', storeId.name)} = :subscriptionStoreId`)
          .getQuery();
        return `EXISTS ${link}`;
      }, { subscriptionStoreId: storeKey });
    }

    return qb.orderBy('subscription.createdAt', 'DESC').getMany();
  }

  /**
   * A merchant or subscription id limits templates to the store type on that
   * subscription's plan. With neither, this is the master catalog.
   */
  async getRoleTemplates(filter: RoleTemplateFilterDTO): Promise<RoleTemplateRecord[]> {
    const scope = await this.subscriptionScope(filter);
    if (scope === 'missing') return [];
    const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
    if (filter.storeId?.trim() && !store) return [];

    if (scope === 'catalog') {
      const merchantUuid = store?.merchantUuid ?? null;
      const qb = this.repo(RoleTemplateEntity).createQueryBuilder('roleTemplate');
      if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
      if (filter.scopeType?.trim()) this.whereEqual(qb, 'scopeType', filter.scopeType.trim().toUpperCase());
      if (store) await this.joinStoreRoleTemplates(qb, store, merchantUuid, 'id');
      const rows = await qb.orderBy('roleTemplate.name', 'ASC').getMany();
      return rows.map(row => this.masterRoleTemplate(row));
    }

    const templateIds = await this.roleTemplateIdsForPlans(scope.plans, scope.subscriptions);
    if (!templateIds.length) return [];
    const assignedIds = store ? await this.storeRoleTemplateIds(store) : null;
    if (assignedIds && !assignedIds.length) return [];
    const allowed = new Set(assignedIds ? templateIds.filter(id => assignedIds.includes(id)) : templateIds);
    if (!allowed.size) return [];

    const masters = await this.repo(RoleTemplateEntity).createQueryBuilder('roleTemplate')
      .where('roleTemplate.id IN (:...templateIds)', { templateIds: [...allowed] })
      .orderBy('roleTemplate.name', 'ASC')
      .getMany();
    const copies = scope.merchantUuid
      ? await this.repo(MerchantRoleTemplateEntity).createQueryBuilder('roleTemplate')
        .where('roleTemplate.merchantId = :roleTemplateMerchantId', { roleTemplateMerchantId: scope.merchantUuid })
        .andWhere('roleTemplate.sourceRoleTemplateId IN (:...templateIds)', { templateIds: [...allowed] })
        .getMany()
      : [];
    const copyBySource = new Map(copies.map(copy => [copy.sourceRoleTemplateId, copy]));
    return masters
      .map(master => {
        const copy = copyBySource.get(master.id);
        return copy ? this.merchantRoleTemplate(copy) : this.masterRoleTemplate(master);
      })
      .filter(row => this.matchesRoleTemplate(row, filter));
  }

  /**
   * A merchant or subscription id returns the features on that subscription:
   * plan entitlements, the plan's included features, and the subscription entitlement list.
   */
  async getFeatures(filter: FeatureFilterDTO): Promise<FeatureEntity[]> {
    const scope = await this.subscriptionScope(filter);
    if (scope === 'missing') return [];
    const qb = this.repo(FeatureEntity).createQueryBuilder('feature');
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
    if (filter.category?.trim()) this.whereEqual(qb, 'category', filter.category.trim().toUpperCase());

    if (scope !== 'catalog') {
      const matched = await this.featureIdsForSubscriptions(scope.subscriptions, scope.plans);
      if (!matched.ids.length && !matched.keys.length) return [];
      qb.andWhere(new Brackets(clause => {
        if (matched.ids.length) clause.where('feature.id IN (:...featureIds)', { featureIds: matched.ids });
        if (matched.keys.length) {
          const keyMatch = 'UPPER(feature.featureCode) IN (:...featureKeys)';
          if (matched.ids.length) clause.orWhere(keyMatch, { featureKeys: matched.keys });
          else clause.where(keyMatch, { featureKeys: matched.keys });
        }
      }));
    }

    const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
    if (filter.storeId?.trim() && !store) return [];
    if (store) {
      const storeFeature = await this.requireColumn('store_entitlements', 'feature_id', 'featureId');
      const storeColumn = await this.requireColumn('store_entitlements', 'store_id', 'storeId');
      const storeKey = this.storeKey(store, storeColumn);
      if (!storeKey) return [];
      const enabled = await this.enabledColumn('store_entitlements');
      const enabledSql = enabled ? ` AND ${this.ref('storeEntitlement', enabled)} = true` : '';
      qb.innerJoin(
        'store_entitlements',
        'storeEntitlement',
        `${this.ref('storeEntitlement', storeFeature.name)} = feature.id AND ${this.ref('storeEntitlement', storeColumn.name)} = :featureStoreId${enabledSql}`,
        { featureStoreId: storeKey },
      );
    }

    return qb.distinct(true).orderBy('feature.name', 'ASC').getMany();
  }

  async findMerchant(merchantId: string): Promise<MerchantEntity | null> {
    const businessId = await this.merchants.resolveMerchantId(merchantId.trim());
    if (!businessId) return null;
    return this.repo(MerchantEntity).findOne({
      where: { merchantId: businessId },
      order: { createdAt: 'DESC' },
    });
  }

  private async subscriptionScope(filter: { merchantId?: string; subscriptionId?: string; planId?: string }): Promise<'catalog' | 'missing' | {
    subscriptions: SubscriptionEntity[];
    plans: PlanEntity[];
    merchantUuid: string | null;
  }> {
    const subscriptionId = filter.subscriptionId?.trim();
    const merchantInput = filter.merchantId?.trim();
    const planInput = filter.planId?.trim();
    if (!subscriptionId && !merchantInput && !planInput) return 'catalog';

    const qb = this.repo(SubscriptionEntity).createQueryBuilder('subscription');
    let constrained = false;
    if (subscriptionId) {
      qb.andWhere('(subscription.id = :subscriptionLookup OR subscription.subscriptionCode = :subscriptionLookup)', {
        subscriptionLookup: subscriptionId,
      });
      constrained = true;
    }
    if (merchantInput) {
      const merchantId = await this.optionalMerchantBusinessId(merchantInput);
      if (!merchantId) return 'missing';
      this.whereEqual(qb, 'merchantId', merchantId);
      constrained = true;
    }
    let subscriptions = constrained ? await qb.getMany() : [];
    if (planInput) {
      const planCode = planInput.toUpperCase();
      subscriptions = subscriptions.filter(row => row.planId === planInput || row.planCode === planCode);
    }
    if (constrained && !subscriptions.length) return 'missing';

    const planIds = [...new Set(subscriptions.map(row => row.planId).filter((id): id is string => Boolean(id)))];
    let plans: PlanEntity[] = [];
    if (planIds.length) {
      plans = await this.repo(PlanEntity).createQueryBuilder('plan')
        .where('plan.id IN (:...planIds)', { planIds })
        .getMany();
    } else if (planInput) {
      const plan = await this.repo(PlanEntity).createQueryBuilder('plan')
        .where('plan.id = :planLookup OR plan.planCode = :planCodeLookup', {
          planLookup: planInput,
          planCodeLookup: planInput.toUpperCase(),
        })
        .getOne();
      if (!plan) return 'missing';
      plans = [plan];
    }
    if (!subscriptions.length && !plans.length) return 'missing';
    const merchantKey = merchantInput || subscriptions[0]?.merchantId;
    const merchantUuid = merchantKey ? await this.merchants.resolveMerchantUuid(merchantKey) : null;
    return { subscriptions, plans, merchantUuid };
  }

  private async roleTemplateIdsForPlans(plans: PlanEntity[], subscriptions: SubscriptionEntity[]): Promise<string[]> {
    const keys = new Set<string>();
    for (const plan of plans) if (plan.storeType?.trim()) keys.add(plan.storeType.trim().toUpperCase());
    for (const subscription of subscriptions) if (subscription.storeTypeName?.trim()) keys.add(subscription.storeTypeName.trim().toUpperCase());
    if (!keys.size) return [];
    const storeTypes = await this.repo(StoreTypeEntity).createQueryBuilder('storeType')
      .where('UPPER(storeType.storeTypeCode) IN (:...storeTypeKeys) OR UPPER(storeType.name) IN (:...storeTypeKeys)', {
        storeTypeKeys: [...keys],
      })
      .getMany();
    if (!storeTypes.length) return [];
    const typeColumn = await this.requireColumn('store_type_role_templates', 'store_type_id', 'storeTypeId');
    const roleColumn = await this.requireColumn('store_type_role_templates', 'role_template_id', 'roleTemplateId');
    const rows = await this.db().createQueryBuilder()
      .select(this.ref('storeTypeRole', roleColumn.name), 'roleTemplateId')
      .from('store_type_role_templates', 'storeTypeRole')
      .where(`${this.ref('storeTypeRole', typeColumn.name)} IN (:...storeTypeIds)`, { storeTypeIds: storeTypes.map(row => row.id) })
      .getRawMany<Record<string, string>>();
    return [...new Set(rows.map(row => this.rawId(row, 'roleTemplateId')).filter(Boolean))];
  }

  private async featureIdsForSubscriptions(subscriptions: SubscriptionEntity[], plans: PlanEntity[]): Promise<{ ids: string[]; keys: string[] }> {
    const tokens = new Set<string>();
    for (const plan of plans) {
      for (const item of plan.includedFeatures || []) if (item) tokens.add(String(item).trim());
    }
    const ids = new Set<string>();
    for (const token of tokens) if (this.isUuid(token)) ids.add(token);
    const planIds = [...new Set([
      ...plans.map(plan => plan.id),
      ...subscriptions.map(subscription => subscription.planId).filter((id): id is string => Boolean(id)),
    ])];
    if (planIds.length) {
      const featureColumn = await this.pickColumn('plan_entitlements', 'feature_id', 'featureId');
      const planColumn = await this.pickColumn('plan_entitlements', 'plan_id', 'planId');
      if (featureColumn && planColumn) {
        const enabled = await this.enabledColumn('plan_entitlements');
        const query = this.db().createQueryBuilder()
          .select(this.ref('planEntitlement', featureColumn.name), 'featureId')
          .from('plan_entitlements', 'planEntitlement')
          .where(`${this.ref('planEntitlement', planColumn.name)} IN (:...planIds)`, { planIds });
        if (enabled) query.andWhere(`${this.ref('planEntitlement', enabled)} = true`);
        const rows = await query.getRawMany<Record<string, string>>();
        for (const row of rows) {
          const id = this.rawId(row, 'featureId');
          if (id) ids.add(id);
        }
      }
    }
    const keys = [...new Set([...tokens].filter(token => !this.isUuid(token)).map(token => token.toUpperCase()))];
    return { ids: [...ids], keys };
  }

  private async storeRoleTemplateIds(store: ResolvedStore): Promise<string[]> {
    const roleColumn = await this.requireColumn('store_role_templates', 'role_template_id', 'roleTemplateId');
    const storeColumn = await this.requireColumn('store_role_templates', 'store_id', 'storeId');
    const storeKey = this.storeKey(store, storeColumn);
    if (!storeKey) return [];
    const rows = await this.db().createQueryBuilder()
      .select(this.ref('storeRoleTemplate', roleColumn.name), 'roleTemplateId')
      .from('store_role_templates', 'storeRoleTemplate')
      .where(`${this.ref('storeRoleTemplate', storeColumn.name)} = :assignedStoreId`, { assignedStoreId: storeKey })
      .andWhere(`${this.ref('storeRoleTemplate', await this.statusColumn('store_role_templates'))} = :assignedStoreStatus`, { assignedStoreStatus: 'ACTIVE' })
      .getRawMany<Record<string, string>>();
    return rows.map(row => this.rawId(row, 'roleTemplateId')).filter(Boolean);
  }

  private matchesRoleTemplate(row: RoleTemplateRecord, filter: RoleTemplateFilterDTO): boolean {
    if (filter.status?.trim() && row.status !== filter.status.trim().toUpperCase()) return false;
    if (filter.scopeType?.trim() && row.scopeType !== filter.scopeType.trim().toUpperCase()) return false;
    return true;
  }

  private masterRoleTemplate(row: RoleTemplateEntity): RoleTemplateRecord {
    return {
      id: row.id,
      merchantId: null,
      sourceRoleTemplateId: null,
      roleCode: row.roleCode,
      name: row.name,
      description: row.description,
      scopeType: row.scopeType,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private merchantRoleTemplate(row: MerchantRoleTemplateEntity): RoleTemplateRecord {
    return {
      id: row.id,
      merchantId: row.merchantId,
      sourceRoleTemplateId: row.sourceRoleTemplateId ?? null,
      roleCode: row.roleCode,
      name: row.name,
      description: row.description,
      scopeType: row.scopeType,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private rawId(row: Record<string, string>, name: string): string {
    return String(row[name] || row[name.toLowerCase()] || '');
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private async joinStoreRoleTemplates(
    qb: SelectQueryBuilder<ObjectLiteral>,
    store: ResolvedStore,
    merchantUuid: string | null,
    templateProperty: 'id' | 'sourceRoleTemplateId',
  ) {
    const linkRole = await this.requireColumn('store_role_templates', 'role_template_id', 'roleTemplateId');
    const linkStore = await this.requireColumn('store_role_templates', 'store_id', 'storeId');
    const storeKey = this.storeKey(store, linkStore);
    if (!storeKey) {
      qb.andWhere('1 = 0');
      return;
    }
    const templateColumn = this.columnName(
      templateProperty === 'id' ? RoleTemplateEntity : MerchantRoleTemplateEntity,
      templateProperty,
    );
    const merchantSql = merchantUuid
      ? ` AND ${this.ref('storeRoleTemplate', (await this.requireColumn('store_role_templates', 'merchant_id', 'merchantId')).name)} = :roleTemplateMerchantId`
      : '';
    qb.innerJoin(
      'store_role_templates',
      'storeRoleTemplate',
      `${this.ref('storeRoleTemplate', linkRole.name)} = ${this.ref(qb.alias, templateColumn)} AND ${this.ref('storeRoleTemplate', linkStore.name)} = :roleTemplateStoreId AND ${this.ref('storeRoleTemplate', await this.statusColumn('store_role_templates'))} = :storeRoleTemplateStatus${merchantSql}`,
      { roleTemplateStoreId: storeKey, roleTemplateMerchantId: merchantUuid, storeRoleTemplateStatus: 'ACTIVE' },
    );
    qb.distinct(true);
  }

  private columnName(entity: new () => ObjectLiteral, property: string): string {
    const column = this.db().getMetadata(entity).findColumnWithPropertyName(property);
    if (!column) throw new ServiceUnavailableException(`Column ${property} is not mapped`);
    return column.databaseName;
  }

  private async enabledColumn(table: string): Promise<string | null> {
    const columns = await this.columns(table);
    if (columns.has('enabled')) return 'enabled';
    if (columns.has('isEnabled')) return 'isEnabled';
    return null;
  }

  private db(): DataSource {
    return this.merchants.requireDataSource();
  }

  private repo<T extends ObjectLiteral>(entity: new () => T) {
    return this.db().getRepository(entity);
  }

  private async optionalMerchantUuid(merchantId?: string): Promise<string | null> {
    const value = merchantId?.trim();
    if (!value) return null;
    return this.merchants.resolveMerchantUuid(value);
  }

  private async optionalMerchantBusinessId(merchantId?: string): Promise<string | null> {
    const value = merchantId?.trim();
    if (!value) return null;
    return this.merchants.resolveMerchantId(value);
  }

  private async resolveStore(storeId: string): Promise<ResolvedStore | null> {
    const store = await this.merchants.getStoreById(storeId.trim());
    if (!store) return null;
    return {
      legacyId: store.id,
      uuid: store.uuid ?? null,
      merchantBusinessId: store.merchantId,
      merchantUuid: await this.merchants.resolveMerchantUuid(store.merchantId),
    };
  }

  /** UUID assignment tables store stores.id; varchar assignment tables store the legacy store code. */
  private storeKey(store: ResolvedStore, column: ColumnRef): string | null {
    if (column.type.toLowerCase().includes('uuid')) return store.uuid;
    return store.legacyId || store.uuid;
  }

  private whereEqual(qb: SelectQueryBuilder<ObjectLiteral>, property: string, value: string) {
    const column = qb.expressionMap.mainAlias?.metadata.findColumnWithPropertyName(property);
    if (!column) throw new ServiceUnavailableException(`Column ${property} is not mapped`);
    const param = `${qb.alias}_${property}`;
    qb.andWhere(`${qb.alias}.${this.quote(column.databaseName)} = :${param}`, { [param]: value });
  }

  private whereContains(qb: SelectQueryBuilder<ObjectLiteral>, property: string, value: string) {
    const column = qb.expressionMap.mainAlias?.metadata.findColumnWithPropertyName(property);
    if (!column) throw new ServiceUnavailableException(`Column ${property} is not mapped`);
    const param = `${qb.alias}_${property}`;
    qb.andWhere(`${qb.alias}.${this.quote(column.databaseName)} ILIKE :${param}`, { [param]: `%${value}%` });
  }

  private async statusColumn(table: string): Promise<string> {
    const column = await this.pickColumn(table, 'status', 'status');
    return column?.name ?? 'status';
  }

  private async requireColumn(table: string, snake: string, camel: string): Promise<ColumnRef> {
    const column = await this.pickColumn(table, snake, camel);
    if (!column) throw new ServiceUnavailableException(`${table}.${snake} is not installed`);
    return column;
  }

  private async pickColumn(table: string, snake: string, camel: string): Promise<ColumnRef | null> {
    const columns = await this.columns(table);
    if (columns.has(snake)) return { name: snake, type: columns.get(snake)! };
    if (columns.has(camel)) return { name: camel, type: columns.get(camel)! };
    return null;
  }

  private async columns(table: string): Promise<Map<string, string>> {
    const cached = this.tableColumns.get(table);
    if (cached) return cached;
    const runner = this.db().createQueryRunner();
    try {
      const meta = await runner.getTable(table);
      const columns = new Map<string, string>();
      for (const column of meta?.columns ?? []) columns.set(column.name, column.type);
      this.tableColumns.set(table, columns);
      return columns;
    } finally {
      await runner.release();
    }
  }

  private async ensureVendorStores(): Promise<void> {
    if (!this.vendorStoresReady) {
      this.vendorStoresReady = ensureVendorStoreSchema(this.db()).catch(error => {
        this.vendorStoresReady = undefined;
        this.tableColumns.delete('vendor_stores');
        throw error;
      });
    }
    await this.vendorStoresReady;
    this.tableColumns.delete('vendor_stores');
  }

  private ref(alias: string, column: string): string {
    return `${alias}.${this.quote(column)}`;
  }

  private quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private omit<T extends object>(rows: T[], fields: string[]): T[] {
    return rows.map(row => {
      const copy = { ...row };
      for (const field of fields) delete (copy as Record<string, unknown>)[field];
      return copy;
    });
  }
}
