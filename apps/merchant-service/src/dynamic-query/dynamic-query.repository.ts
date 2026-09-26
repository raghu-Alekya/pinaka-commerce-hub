import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { EmployeeEntity } from '../entities/employee.entity';
import { FeatureEntity } from '../entities/feature.entity';
import { MerchantEntity } from '../entities/merchant.entity';
import { MerchantRoleTemplateEntity } from '../entities/merchant-role-template.entity';
import { RoleTemplateEntity } from '../entities/role-template.entity';
import { StoreEntity } from '../entities/store.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { VendorEntity } from '../entities/vendor.entity';
import { MerchantRepository } from '../merchant.repository';
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
 * 3. Copy the employee_stores join when the parent is a many-to-many assignment.
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
      const assignment = await this.requireColumn('employee_stores', 'employee_id', 'employeeId');
      const storeColumn = await this.requireColumn('employee_stores', 'store_id', 'storeId');
      qb.innerJoin(
        'employee_stores',
        'assignment',
        `${this.ref('assignment', assignment.name)} = employee.id`,
      );
      qb.andWhere(`${this.ref('assignment', await this.statusColumn('employee_stores'))} = :employeeAssignmentStatus`, {
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
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());

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
   * merchantId returns that merchant's copies. storeId keeps only templates
   * assigned to the store. With neither, this is the master catalog.
   */
  async getRoleTemplates(filter: RoleTemplateFilterDTO): Promise<RoleTemplateRecord[]> {
    const merchantUuid = await this.optionalMerchantUuid(filter.merchantId);
    if (filter.merchantId && !merchantUuid) return [];
    const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
    if (filter.storeId?.trim() && !store) return [];
    if (store?.merchantUuid && merchantUuid && store.merchantUuid !== merchantUuid) return [];
    const ownerUuid = merchantUuid ?? store?.merchantUuid ?? null;

    if (ownerUuid) {
      const qb = this.repo(MerchantRoleTemplateEntity).createQueryBuilder('roleTemplate');
      this.whereEqual(qb, 'merchantId', ownerUuid);
      if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
      if (filter.scopeType?.trim()) this.whereEqual(qb, 'scopeType', filter.scopeType.trim().toUpperCase());
      if (store) await this.joinStoreRoleTemplates(qb, store, ownerUuid, 'sourceRoleTemplateId');
      const rows = await qb.orderBy('roleTemplate.name', 'ASC').getMany();
      return rows.map(row => ({
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
      }));
    }

    const qb = this.repo(RoleTemplateEntity).createQueryBuilder('roleTemplate');
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
    if (filter.scopeType?.trim()) this.whereEqual(qb, 'scopeType', filter.scopeType.trim().toUpperCase());
    if (store) await this.joinStoreRoleTemplates(qb, store, store.merchantUuid, 'id');
    const rows = await qb.orderBy('roleTemplate.name', 'ASC').getMany();
    return rows.map(row => ({
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
    }));
  }

  /**
   * merchantId keeps features enabled on that merchant's subscription plans.
   * storeId keeps features enabled for that store. planId targets one plan.
   */
  async getFeatures(filter: FeatureFilterDTO): Promise<FeatureEntity[]> {
    const qb = this.repo(FeatureEntity).createQueryBuilder('feature');
    const merchantId = await this.optionalMerchantBusinessId(filter.merchantId);
    if (filter.merchantId && !merchantId) return [];
    const store = filter.storeId?.trim() ? await this.resolveStore(filter.storeId) : null;
    if (filter.storeId?.trim() && !store) return [];
    if (filter.status?.trim()) this.whereEqual(qb, 'status', filter.status.trim().toUpperCase());
    if (filter.category?.trim()) this.whereEqual(qb, 'category', filter.category.trim().toUpperCase());

    if (merchantId || filter.planId?.trim()) {
      const entitlementFeature = await this.requireColumn('plan_entitlements', 'feature_id', 'featureId');
      const entitlementPlan = await this.requireColumn('plan_entitlements', 'plan_id', 'planId');
      const enabled = await this.enabledColumn('plan_entitlements');
      const enabledSql = enabled ? ` AND ${this.ref('planEntitlement', enabled)} = true` : '';
      qb.innerJoin(
        'plan_entitlements',
        'planEntitlement',
        `${this.ref('planEntitlement', entitlementFeature.name)} = feature.id${enabledSql}`,
      );
      if (filter.planId?.trim()) {
        qb.andWhere(`${this.ref('planEntitlement', entitlementPlan.name)} = :featurePlanId`, {
          featurePlanId: filter.planId.trim(),
        });
      }
      if (merchantId) {
        const subscriptionMerchant = this.columnName(SubscriptionEntity, 'merchantId');
        const subscriptionPlan = this.columnName(SubscriptionEntity, 'planId');
        qb.innerJoin(
          'subscriptions',
          'merchantSubscription',
          `${this.ref('merchantSubscription', subscriptionPlan)} = ${this.ref('planEntitlement', entitlementPlan.name)} AND ${this.ref('merchantSubscription', subscriptionMerchant)} = :featureMerchantId`,
          { featureMerchantId: merchantId },
        );
      }
    }

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
