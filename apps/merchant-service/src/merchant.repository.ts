import { groupFeaturesByCategory } from './master-list';
import { ensureOnboardingSchema } from './onboarding.schema';
import { ensureMerchantCrudSchema } from './merchant-crud.schema';
import { ensureMerchantIdentitySchema } from './merchant-identity.schema';
import { ensureCompactMerchantSchema } from './compact-merchant.schema';
import { MerchantOnboardingDto } from './onboarding.dto';
import { storeSetup } from './store-setup';
import * as crypto from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';

import { ensureEmployeeAccessSchema } from './employee-access.schema';
import { ensureStoreRoleTemplateSchema } from './store-role-template.schema';
import { ensurePlanSchema } from './plan.schema';
import { FeatureEntity, FeatureStatus } from './entities/feature.entity';
import { PermissionEntity, PermissionStatus } from './entities/permission.entity';
import { RoleTemplateEntity, RoleTemplateStatus, RoleScopeType } from './entities/role-template.entity';
import { PlanEntity, PlanStatus, PlanBillingModel, PlanBillingCycle } from './entities/plan.entity';
import { RoleEntity, RoleStatus } from './entities/role.entity';
import { MerchantRoleTemplateEntity } from './entities/merchant-role-template.entity';
import { CreateMerchantRoleTemplateDto, UpdateMerchantRoleTemplateDto } from './merchant-role-template.dto';
import { CreateStoreRolePermissionDto } from './role-permission.dto';
import { EmployeeEntity, EmployeeStatus } from './entities/employee.entity';
import { CreateFeatureDto, UpdateFeatureDto } from './feature.dto';
import { CreatePermissionDto, UpdatePermissionDto } from './permission.dto';
import { CreateRoleTemplateDto, UpdateRoleTemplateDto } from './role-template.dto';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto';
import { StoreTypeEntity, StoreTypeStatus } from './entities/store-type.entity';
import { CreateStoreTypeDto, UpdateStoreTypeDto } from './store-type.dto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { SessionEntity } from '@pinaka-delivery-hub/auth';
import { MerchantEntity, BusinessType, RetailSubCategory, MerchantStatus, KycStatus } from './entities/merchant.entity';
import { StoreEntity, StoreStatus, OperationalStatus, StoreWebsiteConnectorConfig } from './entities/store.entity';
import { SubscriptionEntity, PlanCode, SubscriptionStatus } from './entities/subscription.entity';
import { OnboardingAuditEntity } from './entities/onboarding-audit.entity';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity';
import { WebsiteConnectionEntity } from './entities/website-connection.entity';
import { CategoryEntity } from './entities/category.entity';
import { ProductEntity } from './entities/product.entity';
import { DeviceEntity } from './entities/device.entity';
import { VendorEntity } from './entities/vendor.entity';
import { TendorEntity } from './entities/tendor.entity';
import { ensureVendorTendorSchema } from './vendor-tendor.schema';
import { ensureDeviceSchema } from './device.schema';
import { ensurePosCurrencyTaxSchema } from './pos/currency-tax/pos-currency-tax.schema';
import { PosCurrencyTaxEntity } from './pos/currency-tax/pos-currency-tax.entity';
import { PosTaxClassEntity } from './pos/currency-tax/pos-tax-class.entity';
import { ensurePosServiceChargeSchema } from './pos/service-charges/pos-service-charge.schema';
import { PosServiceChargeEntity } from './pos/service-charges/pos-service-charge.entity';
import { PosServiceChargeTierEntity } from './pos/service-charges/pos-service-charge-tier.entity';
import { ensurePosCashbackSchema } from './pos/cashback/pos-cashback.schema';
import { PosCashbackEntity } from './pos/cashback/pos-cashback.entity';
import { PosCashbackTierEntity } from './pos/cashback/pos-cashback-tier.entity';
import { ensurePosOpeningBalanceSchema } from './pos/opening-balance/pos-opening-balance.schema';
import { PosOpeningBalanceEntity } from './pos/opening-balance/pos-opening-balance.entity';
import { ensurePosCashDenominationSchema } from './pos/cash-denominations/pos-cash-denomination.schema';
import { PosCashDenominationEntity } from './pos/cash-denominations/pos-cash-denomination.entity';
import { PosCashDenominationItemEntity } from './pos/cash-denominations/pos-cash-denomination-item.entity';
import { ensurePosCashRegisterSchema } from './pos/cash-registers/pos-cash-register.schema';
import { PosCashRegisterSettingsEntity } from './pos/cash-registers/pos-cash-register-settings.entity';
import { PosCashRegisterEntity } from './pos/cash-registers/pos-cash-register.entity';
import { ensurePosSafeDropSchema } from './pos/safe-drop/pos-safe-drop.schema';
import { PosSafeDropEntity } from './pos/safe-drop/pos-safe-drop.entity';
import { PosSafeDropTubeEntity } from './pos/safe-drop/pos-safe-drop-tube.entity';
import { PosSafeDropDenominationEntity } from './pos/safe-drop/pos-safe-drop-denomination.entity';
import { ensurePosCardPaymentSchema } from './pos/card-payments/pos-card-payment.schema';
import { PosCardPaymentEntity } from './pos/card-payments/pos-card-payment.entity';
import { ensurePosTerminalMappingSchema } from './pos/terminal-mappings/pos-terminal-mapping.schema';
import { PosTerminalMappingSettingsEntity } from './pos/terminal-mappings/pos-terminal-mapping-settings.entity';
import { PosTerminalMappingEntity } from './pos/terminal-mappings/pos-terminal-mapping.entity';

interface WordPressProductNode {
  id?: number;
  name?: string;
  price?: string | number;
  image?: string | null;
  tags?: unknown[];
  [key: string]: unknown;
}

interface WordPressCategoryNode {
  id?: number;
  name?: string;
  slug?: string;
  parent?: number;
  description?: string;
  count?: number;
  image?: string | null;
  pos_tax_class?: string;
  pos_tax_percent?: string;
  products?: WordPressProductNode[];
  children?: WordPressCategoryNode[];
}

@Injectable()
export class MerchantRepository implements OnModuleInit {
  async getSubscribedFeatures(merchantId: string, storeTypeId: string) {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) throw new ServiceUnavailableException('Merchant features require PostgreSQL');
    const [merchant] = await this.dataSource.query(
      `SELECT id, "merchantId", "merchantCode" FROM public.merchants
       WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1 LIMIT 1`, [merchantId]);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const [storeType] = await this.dataSource.query(
      `SELECT id, "storeTypeCode", name FROM public.store_types WHERE id::text=$1 LIMIT 1`, [storeTypeId]);
    if (!storeType) throw new NotFoundException('Store type not found');
    const [subscription] = await this.dataSource.query(
      `SELECT to_jsonb(s) AS data FROM public.subscriptions s
       WHERE (COALESCE(to_jsonb(s)->>'merchant_uuid', '')=$1
          OR COALESCE(to_jsonb(s)->>'merchantId', to_jsonb(s)->>'merchant_id')=ANY($2::text[]))
         AND s.status IN ('ACTIVE','TRIAL','TRIALING')
       ORDER BY COALESCE(to_jsonb(s)->>'createdAt', to_jsonb(s)->>'created_at') DESC NULLS LAST`,
      [merchant.id, [merchant.id, merchant.merchantId, merchant.merchantCode].filter(Boolean)]);
    const active = subscription?.data;
    const subscriptionActive = Boolean(active && ['ACTIVE', 'TRIAL', 'TRIALING'].includes(active.status) &&
        !(active.startDate && Date.parse(active.startDate) > Date.now()) &&
        !(active.currentPeriodEnd && Date.parse(active.currentPeriodEnd) <= Date.now()) &&
        !(active.cancelledAt && Date.parse(active.cancelledAt) <= Date.now()));
    const planId = subscriptionActive ? (active.planId || active.plan_id) : null;
    const [plan] = planId ? await this.dataSource.query(
      `SELECT id, status, included_features FROM public.plans WHERE id=$1`, [planId]) : [];
    const activePlan = plan?.status === 'ACTIVE' ? plan : null;
    const tables = await this.dataSource.query(
      `SELECT to_regclass('public.store_type_features') AS store_type_features,
              to_regclass('public.plan_entitlements') AS plan_entitlements,
              to_regclass('public.subscription_entitlements') AS subscription_entitlements`);
    const mapped = tables[0]?.store_type_features
      ? await this.dataSource.query(
        `SELECT f.id, f."featureKey", f.name, f.description, f.category, f."featureType", f.status,
                stf.default_enabled AS "defaultEnabled", stf.required, stf.display_order AS "displayOrder"
         FROM public.store_type_features stf JOIN public.features f ON f.id=stf.feature_id
         WHERE stf.store_type_id=$1 AND f.status='ACTIVE'
         ORDER BY stf.display_order NULLS LAST, f.category NULLS LAST, f.name`, [storeType.id])
      : [];
    const catalog = mapped.length ? mapped : await this.dataSource.query(
      `SELECT f.id, f."featureKey", f.name, f.description, f.category, f."featureType", f.status,
              NULL::boolean AS "defaultEnabled", NULL::boolean AS required, NULL::integer AS "displayOrder"
       FROM public.features f
       WHERE f.status='ACTIVE'
       ORDER BY f.category NULLS LAST, f.name`);
    const enabled = new Map<string, boolean>();
    const grant = (item: unknown, value = true) => {
      if (item && typeof item === 'object') {
        const row = item as { featureId?: string; feature_id?: string; featureKey?: string; id?: string; enabled?: boolean };
        const key = row.featureId || row.feature_id || row.featureKey || row.id;
        if (key) enabled.set(String(key).toLowerCase(), row.enabled !== false && value);
        return;
      }
      if (item !== undefined && item !== null && item !== '') enabled.set(String(item).toLowerCase(), value);
    };
    if (activePlan) {
      for (const item of activePlan.included_features || []) grant(item);
      if (tables[0].plan_entitlements) {
        const rows = await this.dataSource.query(
          `SELECT to_jsonb(e) AS data FROM public.plan_entitlements e WHERE COALESCE(to_jsonb(e)->>'planId',to_jsonb(e)->>'plan_id')=$1`, [activePlan.id]);
        for (const { data } of rows) grant(data, data.enabled === true);
      }
    }
    if (subscriptionActive) {
      const rawEntitlements = active.entitlements;
      const subscriptionFeatures = typeof rawEntitlements === 'string' ? JSON.parse(rawEntitlements) : rawEntitlements;
      if (Array.isArray(subscriptionFeatures)) for (const item of subscriptionFeatures) grant(item);
    }
    if (subscriptionActive && tables[0].subscription_entitlements) {
      const rows = await this.dataSource.query(
        `SELECT to_jsonb(e) AS data FROM public.subscription_entitlements e WHERE COALESCE(to_jsonb(e)->>'subscriptionId',to_jsonb(e)->>'subscription_id')=$1`, [active.id]);
      const now = Date.now();
      for (const { data } of rows) {
        if ((data.effectiveFrom || data.effective_from) && Date.parse(data.effectiveFrom || data.effective_from) > now) continue;
        if ((data.effectiveUntil || data.effective_until) && Date.parse(data.effectiveUntil || data.effective_until) <= now) continue;
        enabled.set(String(data.featureId || data.feature_id).toLowerCase(), data.enabled === true);
      }
    }
    const features = catalog.map((feature: { id: string; featureKey: string; defaultEnabled?: boolean | null }) => {
      const id = feature.id.toLowerCase();
      const included = (enabled.has(id) ? enabled.get(id) : enabled.get(feature.featureKey.toLowerCase())) === true;
      return {
        ...feature,
        included,
        planAccess: included ? 'INCLUDED' : 'NOT_INCLUDED',
        enabledForStore: included && feature.defaultEnabled !== false,
      };
    });
    const categories = groupFeaturesByCategory(features);
    const includedCount = features.filter((feature: { included: boolean }) => feature.included).length;
    return {
      success: true,
      merchantId: merchant.id,
      storeTypeId: storeType.id,
      subscriptionId: subscriptionActive ? active.id : null,
      planId: activePlan?.id || null,
      count: features.length,
      includedCount,
      notIncludedCount: features.length - includedCount,
      all: { category: 'All', count: features.length, features },
      categories,
    };
  }
  async masterData(table: 'store_types' | 'features' | 'role_templates' | 'plans', operation: 'list' | 'get' | 'create' | 'update' | 'delete', id?: string, fields: Record<string, unknown> = {}): Promise<any> {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) throw new ServiceUnavailableException('Master data requires PostgreSQL');
    const columns: Record<string, string> = {
      name: 'name', description: 'description', status: 'status',
      ...({
        store_types: { storeTypeCode: 'storeTypeCode' },
        features: { featureKey: 'featureKey', category: 'category', featureType: 'featureType' },
        role_templates: { roleCode: 'role_code', scopeType: 'scope_type' },
        plans: {
          planCode: 'planCode', billingModel: 'billingModel', basePrice: 'basePrice', currency: 'currency', billingCycle: 'billingCycle',
          storeType: 'store_type', includedStores: 'included_stores', includedTerminals: 'included_terminals',
          additionalTerminalPrice: 'additional_terminal_price', includedEmployees: 'included_employees',
          additionalEmployeePrice: 'additional_employee_price', trialPeriod: 'trial_period',
          effectiveFrom: 'effective_from', includedFeatures: 'included_features',
        },
      }[table]),
    };
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const createdColumn = table === 'role_templates' ? 'created_at' : 'createdAt';
    const updatedColumn = table === 'role_templates' ? 'updated_at' : 'updatedAt';
    const projection = ['id', ...Object.entries(columns).map(([key, column]) => `${quote(column)} AS ${quote(key)}`), `${quote(createdColumn)} AS ${quote('createdAt')}`, `${quote(updatedColumn)} AS ${quote('updatedAt')}`].join(', ');
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.some(([key]) => !columns[key])) throw new BadRequestException('Unknown master data field');
    if (operation === 'update' && !entries.length) throw new BadRequestException('Provide at least one field to update');
    let sql: string;
    let values: unknown[] = [];
    if (operation === 'list') sql = `SELECT ${projection} FROM public.${table} ORDER BY ${quote('name')}, id`;
    else if (operation === 'get') { sql = `SELECT ${projection} FROM public.${table} WHERE id = $1`; values = [id]; }
    else if (operation === 'create') {
      values = [crypto.randomUUID(), ...entries.map(([, value]) => value)];
      sql = `INSERT INTO public.${table} (id, ${entries.map(([key]) => quote(columns[key])).join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING ${projection}`;
    } else if (operation === 'update') {
      values = [id, ...entries.map(([, value]) => value)];
      sql = `UPDATE public.${table} SET ${entries.map(([key], index) => `${quote(columns[key])} = $${index + 2}`).join(', ')}, ${quote(updatedColumn)} = clock_timestamp() WHERE id = $1 RETURNING ${projection}`;
    } else { sql = `DELETE FROM public.${table} WHERE id = $1 RETURNING ${projection}`; values = [id]; }
    try {
      const result = await this.dataSource.query(sql, values);
      // TypeORM returns [rows, affectedCount] for UPDATE and DELETE.
      const rows = operation === 'update' || operation === 'delete' ? result[0] : result;
      if (operation === 'list') return rows;
      if (!rows.length) throw new NotFoundException(`${({ store_types: 'Store type', features: 'Feature', role_templates: 'Role template', plans: 'Plan' })[table]} not found`);
      return rows[0];
    } catch (error: any) {
      const code = error.driverError?.code || error.code;
      if (code === '23505') throw new ConflictException('Master record code or key already exists');
      if (code === '23503') throw new ConflictException('Record is in use. Set status to INACTIVE instead.');
      if (code === '42P01' || code === '42703') throw new ServiceUnavailableException('Master data schema is not installed');
      throw error;
    }
  }

  private dataSource!: DataSource;
  private merchantRepo!: Repository<MerchantEntity>;
  private storeRepo!: Repository<StoreEntity>;
  private storeTypeRepo!: Repository<StoreTypeEntity>;
  private featureRepo!: Repository<FeatureEntity>;
  private permissionRepo!: Repository<PermissionEntity>;
  private roleTemplateRepo!: Repository<RoleTemplateEntity>;
  private planMasterRepo!: Repository<PlanEntity>;
  private roleRepo!: Repository<RoleEntity>;
  private merchantRoleTemplateRepo!: Repository<MerchantRoleTemplateEntity>;
  private employeeRepo!: Repository<EmployeeEntity>;
  private subRepo!: Repository<SubscriptionEntity>;
  private planRepo!: Repository<SubscriptionPlanEntity>;
  private auditRepo!: Repository<OnboardingAuditEntity>;
  private websiteConnectionRepo!: Repository<WebsiteConnectionEntity>;
  private categoryRepo!: Repository<CategoryEntity>;
  private productRepo!: Repository<ProductEntity>;
  private sessionRepo!: Repository<SessionEntity>;
  public deviceRepo!: Repository<DeviceEntity>;
  private redisClient?: Redis;
  private isDbConnected = true;
  private isRedisConnected = false;
  private databaseError?: string;

  get databaseStatus(): string {
    return this.isDbConnected ? 'connected' : `unavailable: ${this.databaseError || 'unknown error'}`;
  }

  requireDataSource(): DataSource {
    if (!this.dataSource?.isInitialized) {
      throw new ServiceUnavailableException('PostgreSQL is unavailable');
    }
    return this.dataSource;
  }

    async onModuleInit() {
    this.dataSource = await connectPostgres('PCH Merchant DB', [
      MerchantEntity,
      StoreEntity,
      StoreTypeEntity,
      FeatureEntity,
      PermissionEntity,
      RoleTemplateEntity,
      PlanEntity,
      RoleEntity,
      MerchantRoleTemplateEntity,
      EmployeeEntity,
      SubscriptionEntity,
      OnboardingAuditEntity,
      SubscriptionPlanEntity,
      WebsiteConnectionEntity,
      CategoryEntity,
      ProductEntity,
      DeviceEntity,
      PosCurrencyTaxEntity,
      PosTaxClassEntity,
      PosServiceChargeEntity,
      PosServiceChargeTierEntity,
      PosCashbackEntity,
      PosCashbackTierEntity,
      PosOpeningBalanceEntity,
      PosCashDenominationEntity,
      PosCashDenominationItemEntity,
      PosCashRegisterSettingsEntity,
      PosCashRegisterEntity,
      PosSafeDropEntity,
      PosSafeDropTubeEntity,
      PosSafeDropDenominationEntity,
      PosCardPaymentEntity,
      PosTerminalMappingSettingsEntity,
      PosTerminalMappingEntity,
      SessionEntity,
      VendorEntity,
      TendorEntity,
    ], { synchronize: false });
    // A brand-new local database has no base tables yet. Bootstrap it once before
    // installing the additive schemas below. Existing databases deliberately skip
    // global synchronization because it can remove repository-owned indexes.
    const [{ core_schema_missing: coreSchemaMissing }] = await this.dataSource.query(`
      SELECT to_regclass('public.merchants') IS NULL
         AND to_regclass('public.stores') IS NULL
         AND to_regclass('public.features') IS NULL AS core_schema_missing
    `);
    if (coreSchemaMissing) {
      const schemaLock = this.dataSource.createQueryRunner();
      await schemaLock.connect();
      try {
        await schemaLock.query('SELECT pg_advisory_lock(724621, 1)');
        try {
          const [{ core_schema_missing: stillMissing }] = await schemaLock.query(`
            SELECT to_regclass('public.merchants') IS NULL
               AND to_regclass('public.stores') IS NULL
               AND to_regclass('public.features') IS NULL AS core_schema_missing
          `);
          if (stillMissing) await this.dataSource.synchronize();
        } finally {
          await schemaLock.query('SELECT pg_advisory_unlock(724621, 1)');
        }
      } finally {
        await schemaLock.release();
      }
    }

    // 1. Initialize all repositories first
    // Repository-managed foreign keys depend on indexes unknown to TypeORM.
    // Keep them intact even when other services opt into TYPEORM_SYNCHRONIZE.
    await ensureMerchantIdentitySchema(this.dataSource);
    await ensureCompactMerchantSchema(this.dataSource);
    await ensureEmployeeAccessSchema(this.dataSource);
    await ensureStoreRoleTemplateSchema(this.dataSource);
    await ensureOnboardingSchema(this.dataSource);
    await ensurePlanSchema(this.dataSource);
    await ensureVendorTendorSchema(this.dataSource);
    await ensureDeviceSchema(this.dataSource);
    await ensurePosCurrencyTaxSchema(this.dataSource);
    await ensurePosServiceChargeSchema(this.dataSource);
    await ensurePosCashbackSchema(this.dataSource);
    await ensurePosOpeningBalanceSchema(this.dataSource);
    await ensurePosCashDenominationSchema(this.dataSource);
    await ensurePosCashRegisterSchema(this.dataSource);
    await ensurePosSafeDropSchema(this.dataSource);
    await ensurePosCardPaymentSchema(this.dataSource);
    await ensurePosTerminalMappingSchema(this.dataSource);
    await ensureMerchantCrudSchema(this.dataSource);
    this.merchantRepo = this.dataSource.getRepository(MerchantEntity);
    this.storeRepo = this.dataSource.getRepository(StoreEntity);
    this.storeTypeRepo = this.dataSource.getRepository(StoreTypeEntity);
    this.featureRepo = this.dataSource.getRepository(FeatureEntity);
    this.permissionRepo = this.dataSource.getRepository(PermissionEntity);
    this.roleTemplateRepo = this.dataSource.getRepository(RoleTemplateEntity);
    this.planMasterRepo = this.dataSource.getRepository(PlanEntity);
    this.roleRepo = this.dataSource.getRepository(RoleEntity);
    this.merchantRoleTemplateRepo = this.dataSource.getRepository(MerchantRoleTemplateEntity);
    this.employeeRepo = this.dataSource.getRepository(EmployeeEntity);
    this.subRepo = this.dataSource.getRepository(SubscriptionEntity);
    this.planRepo = this.dataSource.getRepository(SubscriptionPlanEntity);
    this.auditRepo = this.dataSource.getRepository(OnboardingAuditEntity);
    this.websiteConnectionRepo = this.dataSource.getRepository(WebsiteConnectionEntity);
    this.categoryRepo = this.dataSource.getRepository(CategoryEntity);
    this.productRepo = this.dataSource.getRepository(ProductEntity);
    this.sessionRepo = this.dataSource.getRepository(SessionEntity);
    this.deviceRepo = this.dataSource.getRepository(DeviceEntity);
    this.isDbConnected = true;

    // 2. Safely seed master reference data once all repos are initialized
    await this.seedAllMasterData();
    await this.seedDefaultStoreTypes();
    await this.seedDefaultCommercialPlans();
    await this.seedDefaultPlans();
    try {
      await this.seedDefaultData();
    } catch (error) {
      console.warn('seedDefaultData skipped:', error);
    }

    // 3. Redis Connection
    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [PCH Merchant Redis] Connected to Redis for <1ms PIN & Entitlement caching');
    } catch (err: any) {
      console.log(`⚠️ [PCH Merchant Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultPlans() {
    if (!this.planRepo) return;
    const existing = await this.planRepo.count();
    if (existing > 0) return;
    const now = new Date();
    await this.planRepo.save([
      this.planRepo.create({
        planCode: PlanCode.STARTER,
        planName: 'Starter',
        description: 'Single-store starter plan',
        maxStoresAllowed: 1,
        entitlements: ['POS'],
        billingCycle: 'MONTHLY',
        trialDays: 14,
        price: 0,
        currency: 'USD',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }),
      this.planRepo.create({
        planCode: PlanCode.PRO,
        planName: 'Pro Commerce Plan',
        description: 'Multi-store commerce plan',
        maxStoresAllowed: 3,
        entitlements: ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY'],
        billingCycle: 'MONTHLY',
        trialDays: 0,
        price: 99,
        currency: 'USD',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }),
      this.planRepo.create({
        planCode: PlanCode.ENTERPRISE,
        planName: 'Enterprise',
        description: 'Unlimited stores',
        maxStoresAllowed: 50,
        entitlements: ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY', 'ANALYTICS'],
        billingCycle: 'ANNUAL',
        trialDays: 0,
        price: 999,
        currency: 'USD',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    console.log('âœ… [PCH Seed] Seeded subscription_plans (STARTER, PRO, ENTERPRISE)');
  }

  private async seedDefaultData() {
    if (!this.merchantRepo || !this.storeRepo) return;
    if (!this.merchantRepo || !this.storeRepo || !this.subRepo) return;
    const existing = await this.merchantRepo.findOne({ where: { merchantId: 'MCH-1001' } });
    if (!existing) {
      const mch1 = this.merchantRepo.create({
        id: `MRC-${crypto.randomUUID()}`,
        merchantId: 'MCH-1001',
        businessName: 'Fresh Mart Organics LLC',
        businessType: BusinessType.RETAIL,
        retailSubCategory: RetailSubCategory.GROCERY,
        ownerName: 'Alex Johnson',
        email: 'alex@freshmart.com',
        phone: '+1 (555) 234-5678',
        taxId: '12-3456789',
        billingContact: true,
        kycStatus: KycStatus.VERIFIED,
        status: MerchantStatus.ACTIVE,
        onboardingStep: 'COMPLETED',
      });
      await this.merchantRepo.save(mch1);

      const str1 = this.storeRepo.create({
        id: 'STR-5001',
        merchantId: 'MCH-1001',
        storeName: 'Fresh Mart - Downtown Branch',
        storeCode: 'STR-DT-01',
        storeType: 'GROCERY',
        address: { street: '123 Main St, Suite 400', city: 'Austin', state: 'TX', zipCode: '78701', country: 'USA' },
        currency: 'USD',
        timezone: 'America/Chicago',
        taxRate: 8.25,
        activationPin: '849201',
        status: StoreStatus.ACTIVE,
        operationalStatus: OperationalStatus.OPEN,
        channels: [{ platform: 'POS', externalStoreId: 'POS-01', apiKey: 'key_pos_1', enabled: true }, { platform: 'UBER_EATS', externalStoreId: 'UBER-99', apiKey: 'key_uber', enabled: true }],
      });
      await this.storeRepo.save(str1);

      const sub1 = this.subRepo.create({
        id: 'SUB-9001',
        merchantId: 'MCH-1001',
        planCode: PlanCode.PRO,
        planName: 'Pro Commerce Plan',
        maxStoresAllowed: 3,
        entitlements: ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY'],
        billingCycle: 'MONTHLY',
        trialDays: 0,
        price: 99.00,
        status: SubscriptionStatus.ACTIVE,
      });
      await this.subRepo.save(sub1);

      await this.cacheStorePin(str1.activationPin, str1);
      await this.recordAuditLog('MERCHANT_SEEDED', 'MCH-1001', 'STR-5001', 'system', { seed: true });
      console.log('âœ… [PCH Seed] Seeded Demo Retail Merchant MCH-1001 & Store STR-5001 (PIN: 849201)');
    }
  }

  async recordAuditLog(action: string, merchantId: string, storeId?: string, performedBy = 'system', details: Record<string, any> = {}): Promise<void> {
    const entry: OnboardingAuditEntity = {
      id: `AUDIT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      merchantId,
      storeId,
      action,
      performedBy,
      details,
      createdAt: new Date(),
    };
    await this.auditRepo.save(this.auditRepo.create(entry));
  }

  async allocateId(kind: 'merchant' | 'store'): Promise<string> {
    const prefix = kind === 'merchant' ? 'MER-' : 'STR-';
    const floor = kind === 'merchant' ? 4000 : 50000;
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(734921)');
      await manager.query('CREATE TABLE IF NOT EXISTS public.pch_id_counters (kind text PRIMARY KEY, value bigint NOT NULL)');
      const table = kind === 'merchant' ? 'merchants' : 'stores';
      const [row] = await manager.query('INSERT INTO public.pch_id_counters(kind,value) SELECT $1, GREATEST($2::bigint, COALESCE(MAX(substring(id from $3)::bigint),0))+1 FROM public.' + table + ' WHERE id ~ $4 ON CONFLICT(kind) DO UPDATE SET value = GREATEST(pch_id_counters.value, EXCLUDED.value-1)+1 RETURNING value', [kind, floor, '[0-9]+$', '^' + prefix + '[0-9]+$']);
      return prefix + row.value;
    });
  }

  async saveOnboarding(body: MerchantOnboardingDto, editing: boolean) {
    if (!this.dataSource?.isInitialized) throw new ServiceUnavailableException('Onboarding requires PostgreSQL');
    const id = body.merchant.code;
    const incoming = body.stores || [];
    if (incoming.some(store => store.merchantId !== id)) throw new BadRequestException('All stores must belong to this merchant');
    if (new Set(incoming.map(store => store.storeId)).size !== incoming.length) throw new BadRequestException('Store IDs must be unique');
    const m = body.merchant;
    let result;
    try {
      result = await this.dataSource.transaction(async manager => {
        const merchants = manager.getRepository(MerchantEntity);
        const stores = manager.getRepository(StoreEntity);
        const subscriptions = manager.getRepository(SubscriptionEntity);
        const existing = await merchants.findOne({ where: { merchantId:id }, lock: { mode: 'pessimistic_write' } });
        if (editing && !existing) throw new NotFoundException('Merchant not found');
        if (!editing && existing) throw new ConflictException('Merchant code already exists');
        const merchant = merchants.create({ ...existing, id:existing?.id || `MRC-${crypto.randomUUID()}`, merchantId:id, businessName: m.display,
          legalBusinessName: m.business, ownerName: m.name, email: m.email.toLowerCase(), phone: m.phone,
          country: m.country, city: m.city, state: m.state, postalCode: m.postal, businessAddress: m.address,
          status: existing?.status || MerchantStatus.PENDING,
          onboardingStep: incoming.length ? 'COMPLETED' : existing?.onboardingStep || 'STEP2_STORE',
        });
        // Save everything in one transaction: no partial merchant when a store or plan fails.
        await merchants.save(merchant);
        let subscription = await subscriptions.findOne({ where: { merchantId: id }, order: { createdAt: 'DESC' } });
        if (body.subscription) {
          const fields = await this.prepareSubscriptionContract({ ...body.subscription,
            status: subscription?.status || SubscriptionStatus.PENDING,
          }, subscription || undefined);
          if (fields.licensedStoreCount == null || fields.licensedDeviceCount == null) {
            throw new BadRequestException('The plan must define store/device limits, or supply the agreed license counts');
          }
          const start = body.subscription.startDate;
          const renewal = new Date(start + 'T00:00:00Z');
          const day = renewal.getUTCDate();
          renewal.setUTCDate(1);
          renewal.setUTCMonth(renewal.getUTCMonth() + (body.subscription.billingCycle === 'ANNUAL' ? 12 : 1));
          const last = new Date(Date.UTC(renewal.getUTCFullYear(), renewal.getUTCMonth() + 1, 0)).getUTCDate();
          renewal.setUTCDate(Math.min(day, last));
          const subId = subscription?.id || `SUB-${crypto.randomUUID()}`;
          subscription = await subscriptions.save(subscriptions.create({ ...subscription, ...fields,
            id: subId, subscriptionCode: subscription?.subscriptionCode || subId, merchantId: id,
            renewalDate: renewal.toISOString().slice(0,10), currentPeriodEnd: renewal,
          }));
        }
        if (!subscription) throw new BadRequestException('Create a merchant subscription before adding stores');
        for (const item of incoming) {
          const current = await stores.findOneBy({ id: item.storeId });
          if (current && current.merchantId !== id) throw new ConflictException(`Store '${item.storeId}' belongs to another merchant`);
          const type = await this.getStoreTypeByIdOrCode(item.type || '');
          if (!type || type.status !== 'ACTIVE') throw new BadRequestException('Select an active store type master code');
          const fields = { id: item.storeId, storeCode: item.storeId, storeName: item.name.trim(),
            storeType: type.storeTypeCode, phone: item.phone, baseUrl: item.url, currency: item.currency || subscription.currency || 'USD',
            timezone: item.timezone || 'UTC', status: current?.status || StoreStatus.PENDING,
            address: { street: item.address.trim(), city: item.city.trim(), state: item.state.trim(), zipCode: item.zip.trim(), country: item.country || m.country },
            onboardingSetup: storeSetup(item, current?.onboardingSetup),
          };
          await stores.save(current ? { ...current, ...fields } : this.buildStore(id, fields));
        }
        const savedStores = await stores.find({ where: { merchantId: id } });
        const licensed = savedStores.filter(store => store.onboardingSetup?.licensed === true);
        const devices = savedStores.flatMap(store => (store.onboardingSetup?.devices || []) as Array<Record<string, unknown>>);
        if (licensed.length > (subscription.licensedStoreCount ?? subscription.maxStoresAllowed)) throw new BadRequestException('Store license limit exceeded');
        if (devices.length > (subscription.licensedDeviceCount ?? 0)) throw new BadRequestException('Device license limit exceeded');
        const serials = devices.map(d => String(d.serial).trim().toLowerCase());
        if (new Set(serials).size !== serials.length) throw new BadRequestException('Device identifiers must be unique across stores');
        await manager.getRepository(OnboardingAuditEntity).save({ id: `AUD-${crypto.randomUUID()}`, merchantId: id,
          action: editing ? 'ONBOARDING_UPDATED' : 'ONBOARDING_CREATED', performedBy: 'merchant',
          details: { storeCount: savedStores.length, subscriptionId: subscription.id },
        });
        return { merchant, stores: savedStores, subscription };
      });
    } catch (error: any) {
      if ((error.driverError?.code || error.code) === '23505') throw new ConflictException('Merchant email, merchant code or store code already exists');
      throw error;
    }
    for (const store of result.stores) await this.cacheStorePin(store.activationPin, store);
    return result;
  }

  async createMerchant(data: Partial<MerchantEntity>): Promise<MerchantEntity> {
    const id = data.id || await this.allocateId('merchant');
    const merchant: MerchantEntity = {
      id: `MRC-${crypto.randomUUID()}`,
      merchantId: data.merchantId || id,
      businessName: data.businessName || 'New Merchant Business',
      businessType: data.businessType || BusinessType.RETAIL,
      retailSubCategory: data.retailSubCategory || (data.businessType === BusinessType.RETAIL ? RetailSubCategory.GROCERY : undefined),
      ownerName: data.ownerName || 'Owner Name',
      email: data.email || `owner_${Date.now()}@pinaka.com`,
      phone: data.phone || '',
      taxId: data.taxId || '',
      legalBusinessName: data.legalBusinessName,
      country: data.country,
      state: data.state,
      city: data.city,
      postalCode: data.postalCode,
      businessAddress: data.businessAddress,
      firstName: data.firstName,
      lastName: data.lastName,
      jobTitle: data.jobTitle,
      alternatePhone: data.alternatePhone,
      billingContact: data.billingContact ?? true,
      kycStatus: data.kycStatus || KycStatus.PENDING,
      kycDocuments: data.kycDocuments || [],
      status: data.status || MerchantStatus.PENDING,
      onboardingStep: data.onboardingStep || 'STEP1_BUSINESS',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const saved = await this.merchantRepo.save(this.merchantRepo.create(merchant));
    await this.recordAuditLog('MERCHANT_CREATED', saved.merchantId!, undefined, saved.email, { businessName: saved.businessName });
    return {...saved,id:saved.merchantId!};
  }

  async getAllMerchants(): Promise<MerchantEntity[]> {
    return this.merchantRepo.find({ order: { createdAt: 'DESC' } });
  }

  async updateMerchant(id: string, data: Partial<MerchantEntity>): Promise<MerchantEntity | null> {
    const merchant = await this.merchantRepo.findOne({ where: { merchantId:id }, order:{createdAt:'DESC'} });
    if (!merchant) return null;
    Object.assign(merchant, data, { id:merchant.id, merchantId:merchant.merchantId, updatedAt: new Date() });
    const saved = await this.merchantRepo.save(merchant);
    await this.recordAuditLog('MERCHANT_UPDATED', id, undefined, saved.email, { businessName: saved.businessName });
    return saved;
  }

  async getMerchantById(id: string): Promise<{ merchant: MerchantEntity | null; stores: StoreEntity[]; subscription: SubscriptionEntity | null }> {
    const merchantId = await this.resolveMerchantId(id);
    const merchant = merchantId ? await this.merchantRepo.findOne({ where: { merchantId }, order:{createdAt:'DESC'} }) : null;
    if (!merchant) return { merchant: null, stores: [], subscription: null };
    const stores = await this.storeRepo.find({ where: { merchantId: merchant.merchantId } });
    const subscription = (await this.listSubscriptions(merchant.merchantId!))[0] || null;
    return { merchant:{...merchant,id:merchant.merchantId!}, stores, subscription };
  }

  async resolveMerchantId(idOrUuid: string): Promise<string | null> {
    const rows = await this.dataSource.query('SELECT "merchantId" FROM public.merchants WHERE "merchantId"=$1 OR "merchantCode"=$1 OR id::text=$1 LIMIT 1', [idOrUuid]);
    return rows[0]?.merchantId || null;
  }

  async resolveMerchantUuid(idOrUuid: string): Promise<string | null> {
    const rows = await this.dataSource.query('SELECT m.id FROM public.merchants m LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode" WHERE m."merchantId"=$1 OR m."merchantCode"=$1 OR m.id::text=$1 ORDER BY v.version ASC NULLS LAST,m."createdAt" LIMIT 1', [idOrUuid]);
    return rows[0]?.id || null;
  }

  private buildStore(merchantId: string, data: Partial<StoreEntity>): StoreEntity {
    const id = data.id || `STR-${Math.floor(5000 + Math.random() * 5000)}`;
    const activationPin = data.activationPin || Math.floor(100000 + Math.random() * 900000).toString();
    const storeCode = data.storeCode || `STR-${Date.now().toString().slice(-4)}`;
    return {
      id,
      merchantId,
      storeName: data.storeName || 'Store Branch',
      storeCode,
      storeType: data.storeType || 'RETAIL',
      baseUrl: data.baseUrl,
      phone: data.phone,
      address: data.address || { street: '', city: '', state: '', zipCode: '', country: 'USA' },
      currency: data.currency || 'USD',
      timezone: data.timezone || 'America/Chicago',
      taxRate: data.taxRate !== undefined ? Number(data.taxRate) : 8.25,
      activationPin,
      autoAcceptOrders: data.autoAcceptOrders ?? true,
      status: data.status || StoreStatus.ACTIVE,
      operationalStatus: data.operationalStatus || OperationalStatus.OPEN,
      onboardingSetup: data.onboardingSetup || {},
      channels: data.channels || [{ platform: 'POS', externalStoreId: id, apiKey: `key_${id}`, enabled: true }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async createStore(merchantId: string, data: Partial<StoreEntity>): Promise<StoreEntity> {
    const generatedId = data.id || await this.allocateId('store');
    const store = this.buildStore(merchantId, { ...data, id: generatedId, storeCode: data.storeCode || generatedId });
    const { activationPin } = store;
    const entity = this.storeRepo.create(store);
    try {
      await this.storeRepo.insert(entity);
    } catch (error: any) {
      if (error.code === '23505' || error.driverError?.code === '23505') {
        throw new ConflictException('Store ID or store code already exists. Choose a different Store ID.');
      }
      throw error;
    }
    await this.cacheStorePin(activationPin, entity);
    await this.recordAuditLog('STORE_CREATED', merchantId, entity.id, 'merchant', { storeName: entity.storeName, pin: activationPin });
    return entity;
  }

  async createStoresBatch(merchantId: string, data: Partial<StoreEntity>[]): Promise<StoreEntity[]> {
    const stores = await Promise.all(data.map(async item => { const id = item.id || await this.allocateId('store'); return this.buildStore(merchantId, { ...item, id, storeCode: item.storeCode || id }); }));
    if (new Set(stores.map(s => s.id)).size !== stores.length ||
        new Set(stores.map(s => s.storeCode)).size !== stores.length) {
      throw new ConflictException('Each store must have a unique Store ID.');
    }
    try {
      await this.storeRepo.manager.transaction(async manager => {
        await manager.insert(StoreEntity, stores);
      });
    } catch (error: any) {
      if (error.code === '23505' || error.driverError?.code === '23505') {
        throw new ConflictException('A Store ID already exists. No stores were added.');
      }
      throw error;
    }
    for (const store of stores) {
      await this.cacheStorePin(store.activationPin, store);
      await this.recordAuditLog('STORE_CREATED', merchantId, store.id, 'merchant', { storeName: store.storeName });
    }
    return stores;
  }

  async createOrUpdateStore(merchantId: string, data: Partial<StoreEntity>): Promise<StoreEntity> {
    if (data.id) {
      const existing = await this.storeRepo.findOne({ where: { id: data.id } });
      if (existing) {
        if (existing.merchantId !== merchantId) throw new Error(`Store ID '${data.id}' belongs to another merchant`);
        Object.assign(existing, data, { merchantId, updatedAt: new Date() });
        const saved = await this.storeRepo.save(existing);
        await this.recordAuditLog('STORE_UPDATED', merchantId, saved.id, 'merchant', { storeName: saved.storeName });
        return saved;
      }
    }
    return this.createStore(merchantId, data);
  }

  async getStoreById(id: string): Promise<StoreEntity | null> {
    const rows = await this.dataSource.query('SELECT legacy_store_id FROM public.stores WHERE legacy_store_id=$1 OR id::text=$1 LIMIT 1', [id]);
    return rows[0] ? this.storeRepo.findOneBy({ id: rows[0].legacy_store_id }) : null;
  }

  
  async createDevice(data: {
    id: string;
    deviceName?: string;
    deviceCode?: string;
    deviceType?: string;
    merchantId: string;
    merchantName?: string;
    serialNumber: string;
    status?: string;
    createdAt?: Date;
  }): Promise<DeviceEntity> {
    if (!this.deviceRepo) {
      throw new ServiceUnavailableException('Database not connected');
    }
    const entity = this.deviceRepo.create({
      id: data.id,
      deviceName: data.deviceName || 'Unnamed device',
      deviceCode: data.deviceCode || `DEV-${data.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      deviceType: data.deviceType || 'Other',
      merchantId: data.merchantId,
      merchantName: data.merchantName || data.merchantId,
      serialNumber: data.serialNumber,
      status: data.status || 'Active',
      createdAt: data.createdAt || new Date(),
    });

    try {
      return await this.deviceRepo.save(entity);
    } catch (error: any) {
      const code = error.driverError?.code || error.code;
      if (code === '23505') {
        throw new ConflictException('Device code or serial number already exists');
      }
      throw error;
    }
  }

  async getDevice(id: string): Promise<DeviceEntity | null> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    return this.deviceRepo.findOne({ where: { id } });
  }

  async updateDevice(id: string, fields: Partial<DeviceEntity>): Promise<DeviceEntity> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    try {
      const current = await this.deviceRepo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('Device not found');
      return await this.deviceRepo.save(Object.assign(current, fields));
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      if ((error.driverError?.code || error.code) === '23505') {
        throw new ConflictException('Device code or serial number already exists');
      }
      throw error;
    }
  }

  async deleteDevice(id: string): Promise<boolean> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    return (await this.deviceRepo.delete(id)).affected === 1;
  }

  async queryDevices(filters: {
    page: number; limit: number; search?: string; merchantId?: string;
    deviceType?: string; status?: string; from?: Date; to?: Date;
  }): Promise<{ devices: DeviceEntity[]; total: number; summary: Record<string, number> }> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    if (typeof (this.deviceRepo as any).createQueryBuilder !== 'function') {
      const all = await this.deviceRepo.find({ order: { createdAt: 'DESC' } });
      const filtered = all.filter(device =>
        (!filters.merchantId || device.merchantId === filters.merchantId) &&
        (!filters.deviceType || device.deviceType === filters.deviceType) &&
        (!filters.search || [device.deviceName, device.deviceCode, device.serialNumber].some(value => value.toLowerCase().includes(filters.search!.toLowerCase()))) &&
        (!filters.from || device.createdAt >= filters.from) && (!filters.to || device.createdAt < filters.to));
      const devices = filtered.slice((filters.page - 1) * filters.limit, filters.page * filters.limit);
      return { devices, total: filtered.length, summary: {} };
    }
    const query = this.deviceRepo.createQueryBuilder('device');
    if (filters.search) query.andWhere(`(device."deviceName" ILIKE :search OR device."deviceCode" ILIKE :search OR device."serialNumber" ILIKE :search)`, { search: `%${filters.search}%` });
    if (filters.merchantId) query.andWhere('device."merchantId" = :merchantId', { merchantId: filters.merchantId });
    if (filters.deviceType) query.andWhere('device."deviceType" = :deviceType', { deviceType: filters.deviceType });
    if (filters.status?.toLowerCase() === 'active') query.andWhere(`device.status = 'Active'`);
    if (filters.status?.toLowerCase() === 'inactive') query.andWhere(`device.status = 'Inactive'`);
    if (filters.status?.toLowerCase() === 'offline') query.andWhere(`device.status = 'Active'`);
    if (filters.status?.toLowerCase() === 'online') query.andWhere('1 = 0');
    if (filters.from) query.andWhere('device."createdAt" >= :from', { from: filters.from });
    if (filters.to) query.andWhere('device."createdAt" < :to', { to: filters.to });
    const [devices, total] = await query.orderBy('device."createdAt"', 'DESC')
      .skip((filters.page - 1) * filters.limit).take(filters.limit).getManyAndCount();
    const summaryRows = await this.deviceRepo.createQueryBuilder('device')
      .select('device.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('device.status').getRawMany();
    const summary = Object.fromEntries(summaryRows.map((row: any) => [String(row.status).toLowerCase(), Number(row.count)]));
    return { devices, total, summary };
  }

  async listDevices(): Promise<DeviceEntity[]> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    return this.deviceRepo.find({ order: { createdAt: 'DESC' } });
  }

  async listDevicesByMerchantId(merchantId: string): Promise<DeviceEntity[]> {
    if (!this.deviceRepo) throw new ServiceUnavailableException('Database not connected');
    return this.deviceRepo.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  async listStores(merchantId?: string): Promise<StoreEntity[]> {
    const resolved = merchantId ? await this.resolveMerchantId(merchantId) : undefined;
    if (merchantId && !resolved) return [];
    return this.storeRepo.find({ where: resolved ? { merchantId: resolved } : {}, order: { createdAt: 'DESC' } });
  }

  async updateStore(id: string, fields: Partial<StoreEntity>): Promise<StoreEntity | null> {
    const store = await this.getStoreById(id);
    if (!store) return null;
    const updated = { ...store, ...fields, id, merchantId: store.merchantId, updatedAt: new Date() };
    if (!(await this.storeRepo.update(id, { ...fields, updatedAt: updated.updatedAt })).affected) return null;
    await this.cacheStorePin(updated.activationPin, updated);
    await this.recordAuditLog('STORE_UPDATED', store.merchantId, id, 'merchant', { storeName: updated.storeName });
    return updated;
  }

  async saveWebsiteConnector(
    storeId: string,
    connector: StoreWebsiteConnectorConfig,
  ): Promise<StoreEntity | null> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) return null;
    store.websiteConnector = connector;
    store.updatedAt = new Date();
    return this.storeRepo.save(store);
  }

  async getWebsiteConnector(storeId: string): Promise<StoreWebsiteConnectorConfig | null> {
    const connection = await this.websiteConnectionRepo.findOneBy({ storeId });
    if (connection) {
      return {
        provider: 'WORDPRESS',
        wordpressUrl: connection.wordpressUrl,
        encryptedJwt: connection.encryptedJwt,
        updatedAt: connection.updatedAt.toISOString(),
      };
    }
    const store = await this.storeRepo
      .createQueryBuilder('store')
      .addSelect('store.websiteConnector')
      .where('store.id = :storeId', { storeId })
      .getOne();
    return store?.websiteConnector ?? null;
  }

  async saveWebsiteConnection(fields: {
    storeId: string;
    merchantId: string;
    wordpressUrl: string;
    encryptedJwt: string;
    status: 'CONNECTED' | 'NOT_CONNECTED';
    lastTestedAt?: Date | null;
    lastTestMessage?: string | null;
  }): Promise<WebsiteConnectionEntity> {
    const existing = await this.websiteConnectionRepo.findOneBy({ storeId: fields.storeId });
    const entity = existing
      ? Object.assign(existing, fields, { updatedAt: new Date() })
      : this.websiteConnectionRepo.create(fields);
    const saved = await this.websiteConnectionRepo.save(entity);
    await this.saveWebsiteConnector(fields.storeId, {
      provider: 'WORDPRESS',
      wordpressUrl: fields.wordpressUrl,
      encryptedJwt: fields.encryptedJwt,
      updatedAt: saved.updatedAt.toISOString(),
    });
    return saved;
  }

  async getWebsiteConnection(storeId: string): Promise<WebsiteConnectionEntity | null> {
    return this.websiteConnectionRepo.findOneBy({ storeId });
  }

  async touchSession(sessionId: string, accessToken: string): Promise<SessionEntity | null> {
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const session = await this.sessionRepo
      .createQueryBuilder('session')
      .addSelect('session.accessTokenHash')
      .where('session.id = :sessionId', { sessionId })
      .getOne();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.accessTokenHash !== accessTokenHash
    ) {
      return null;
    }
    session.lastUsedAt = new Date();
    await this.sessionRepo.update(session.id, { lastUsedAt: session.lastUsedAt });
    return session;
  }

  async activateTerminalByPin(pin: string): Promise<{ success: boolean; store?: StoreEntity; entitlements?: string[]; message?: string }> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const cached = await this.redisClient.get(`pin:${pin}`);
        if (cached) {
          const store = JSON.parse(cached) as StoreEntity;
          const { subscription } = await this.getMerchantById(store.merchantId);
          return {
            success: true,
            store,
            entitlements: subscription?.entitlements || ['POS'],
          };
        }
      } catch {}
    }

    const store = await this.storeRepo.findOne({ where: { activationPin: pin } });
    if (!store) {
      return { success: false, message: 'Invalid 6-digit Activation PIN. Terminal pairing failed.' };
    }

    const { subscription } = await this.getMerchantById(store.merchantId);
    await this.cacheStorePin(pin, store);
    return {
      success: true,
      store,
      entitlements: subscription?.entitlements || ['POS', 'BARCODE_SCANNING'],
    };
  }

  async createOrUpdateSubscription(merchantId: string, data: Partial<SubscriptionEntity>): Promise<SubscriptionEntity> {
    const previous = (await this.listSubscriptions(merchantId)).find(row =>
      [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE].includes(row.status));
    const fields = await this.prepareSubscriptionContract(data, previous);
    const sub: SubscriptionEntity = {
      ...previous,
      ...fields,
      id: previous?.id || data.id || `SUB-${crypto.randomUUID()}`,
      merchantId,
      createdAt: previous?.createdAt || new Date(),
      updatedAt: new Date(),
    } as SubscriptionEntity;
    sub.subscriptionCode ||= sub.id;
    const saved = previous ? await this.updateSubscription(previous.id, fields) : await this.insertSubscription(sub);
    if (!saved) throw new NotFoundException('Subscription not found');
    await this.recordAuditLog('SUBSCRIPTION_UPDATED', merchantId, undefined, 'system', { planCode: saved.planCode, entitlements: saved.entitlements });
    return saved;
  }

  async listSubscriptions(merchantId?: string): Promise<SubscriptionEntity[]> {
    const rows = await this.subRepo.find({ where: merchantId ? { merchantId } : {}, order: { createdAt: 'DESC', id: 'DESC' } });
    const current = (row: SubscriptionEntity) => [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE].includes(row.status);
    return rows.sort((a,b) => Number(current(b))-Number(current(a)));
  }

  async getSubscription(id: string): Promise<SubscriptionEntity | null> {
    return this.subRepo.findOneBy({ id });
  }

  async insertSubscription(subscription: SubscriptionEntity): Promise<SubscriptionEntity> {
    try { await this.subRepo.insert(subscription); }
    catch (error: any) {
      this.subscriptionWriteError(error);
      throw error;
    }
    await this.recordAuditLog('SUBSCRIPTION_CREATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: subscription.id });
    return (await this.getSubscription(subscription.id))!;
  }

  async updateSubscription(id: string, fields: Partial<SubscriptionEntity>): Promise<SubscriptionEntity | null> {
    const existing = await this.getSubscription(id);
    if (!existing) return null;
    const subscription = { ...existing, ...fields, id, merchantId: existing.merchantId, createdAt: existing.createdAt, updatedAt: new Date() };
    try {
      if (!(await this.subRepo.update(id, { ...fields, updatedAt: subscription.updatedAt })).affected) return null;
    } catch (error) { this.subscriptionWriteError(error); throw error; }
    await this.recordAuditLog('SUBSCRIPTION_UPDATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: id });
    return (await this.getSubscription(id))!;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const existing = await this.getSubscription(id);
    if (!existing) return false;
    try { if (!(await this.subRepo.delete(id)).affected) return false; }
    catch (error) { this.subscriptionWriteError(error); throw error; }
    await this.recordAuditLog('SUBSCRIPTION_DELETED', existing.merchantId, undefined, 'merchant', { subscriptionId: id });
    return true;
  }

  private subscriptionWriteError(error: any): void {
    const code = error.driverError?.code || error.code;
    if (code === '23505') throw new ConflictException('Subscription ID or subscription code already exists');
    if (code === '23503') throw new ConflictException('Subscription references an invalid parent or is in use; cancel it to preserve history');
    if (code === '23514') throw new BadRequestException('Invalid subscription dates, price or licensed counts');
  }

  async prepareSubscriptionContract(input: Record<string, any>, existing?: SubscriptionEntity): Promise<Partial<SubscriptionEntity>> {
    const fields: Record<string, any> = existing ? { ...existing } : {
      status: SubscriptionStatus.ACTIVE, startDate:null, renewalDate:null, trialEndDate:null,
      licensedStoreCount:null, licensedDeviceCount:null, trialDays:0, cancelledAt:null,
      currentPeriodStart:null, currentPeriodEnd:null,
    };
    for (const key of ['subscriptionCode','billingCycle','status','price','currency','startDate','renewalDate','trialEndDate','licensedStoreCount','licensedDeviceCount','trialDays']) {
      if (input[key] !== undefined) fields[key] = input[key];
    }
    const selected = input.planId || input.planCode || existing?.planId || existing?.planCode;
    if (!selected) throw new BadRequestException('Select an active commercial plan');
    const changingPlan = !existing || input.planId !== undefined || input.planCode !== undefined;
    if (changingPlan) {
      const plan = await this.getPlanByIdOrCode(selected);
      if (!plan || plan.status !== 'ACTIVE') throw new BadRequestException('Select an active commercial plan from plans');
      if (input.planId && input.planCode && input.planCode !== plan.planCode) throw new BadRequestException('planId and planCode refer to different plans');
      fields.planId=plan.id; fields.planCode=plan.planCode; fields.planName=plan.name;
      fields.billingCycle=input.billingCycle ?? plan.billingCycle;
      fields.price=input.price ?? Number(plan.basePrice); fields.currency=input.currency ?? plan.currency;
      const entitlements = await this.dataSource.query('SELECT f.feature_key, e.enabled, e.limit_value FROM public.plan_entitlements e JOIN public.features f ON f.id=e.feature_id WHERE e.plan_id=$1',[plan.id]);
      fields.entitlements=entitlements.filter((row: any)=>row.enabled).map((row: any)=>row.feature_key);
      for (const [key,feature] of [['licensedStoreCount','MAX_STORES'],['licensedDeviceCount','MAX_DEVICES']]) {
        if (input[key] === undefined) {
          const value=entitlements.find((row:any)=>row.feature_key===feature && row.enabled)?.limit_value;
          fields[key]=value != null && /^\d+$/.test(value) && Number(value)<=2147483647 ? Number(value) : null;
        }
      }
    }
    if (input.maxStoresAllowed !== undefined) {
      if (input.licensedStoreCount !== undefined && input.licensedStoreCount !== input.maxStoresAllowed) throw new BadRequestException('Conflicting store count fields');
      fields.licensedStoreCount=input.maxStoresAllowed;
    }
    for (const [alias,canonical] of [['currentPeriodStart','startDate'],['currentPeriodEnd','renewalDate']]) {
      if (input[alias] !== undefined) {
        const date=new Date(input[alias]);
        if (!Number.isFinite(date.getTime())) throw new BadRequestException(`Invalid ${alias}`);
        const day=date.toISOString().slice(0,10);
        if (input[canonical] !== undefined && input[canonical] !== day) throw new BadRequestException(`Conflicting ${alias} and ${canonical}`);
        fields[canonical]=day; fields[alias]=date;
      } else if (input[canonical] !== undefined) fields[alias]=input[canonical]===null ? null : new Date(input[canonical]+'T00:00:00Z');
    }
    if (fields.startDate && fields.renewalDate && fields.renewalDate<=fields.startDate) throw new BadRequestException('renewalDate must be after startDate');
    if (fields.startDate && fields.trialEndDate && fields.trialEndDate<fields.startDate) throw new BadRequestException('trialEndDate cannot precede startDate');
    fields.maxStoresAllowed=fields.licensedStoreCount ?? 0;
    if (fields.status===SubscriptionStatus.CANCELLED) fields.cancelledAt=existing?.cancelledAt || new Date();
    else if (existing?.status===SubscriptionStatus.CANCELLED) fields.cancelledAt=null;
    for (const key of ['id','merchantId','createdAt','updatedAt']) delete fields[key];
    return fields;
  }

  private async cacheStorePin(pin: string, store: StoreEntity): Promise<void> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`pin:${pin}`, JSON.stringify(store), 'EX', 86400 * 30);
      } catch {}
    }
  }

  async listSubscriptionPlans(): Promise<SubscriptionPlanEntity[]> {
    return this.planRepo.find({ order: { planCode: 'ASC' } });
  }

  async getSubscriptionPlan(planCode: string): Promise<SubscriptionPlanEntity | null> {
    return this.planRepo.findOneBy({ planCode });
  }

  async createSubscriptionPlan(plan: SubscriptionPlanEntity): Promise<SubscriptionPlanEntity> {
    try { await this.planRepo.insert(plan); }
    catch (error: any) {
      if (error.code === '23505' || error.driverError?.code === '23505') throw new ConflictException('Plan code already exists');
      throw error;
    }
    return plan;
  }

  async updateSubscriptionPlan(planCode: string, fields: Partial<SubscriptionPlanEntity>): Promise<SubscriptionPlanEntity | null> {
    const existing = await this.getSubscriptionPlan(planCode);
    if (!existing) return null;
    const plan = { ...existing, ...fields, planCode, createdAt: existing.createdAt, updatedAt: new Date() };
    if (!(await this.planRepo.update({ planCode }, { ...fields, updatedAt: plan.updatedAt })).affected) return null;
    return plan;
  }

  async deleteSubscriptionPlan(planCode: string): Promise<boolean> {
    if (!(await this.getSubscriptionPlan(planCode))) return false;
    const inUse = await this.subRepo.existsBy({ planCode: planCode as PlanCode });
    if (inUse) throw new ConflictException('Plan is assigned to a merchant. Set its status to INACTIVE instead.');
    return Boolean((await this.planRepo.delete({ planCode })).affected);
  }

  async fetchLiveWordPressCatalog(storeUrl?: string, jwtToken?: string): Promise<Array<{ name: string; category: string; price: number; sku: string; stock: number; description?: string }>> {
    const baseUrl = (storeUrl || 'https://aascorner.alektasolutions.com').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (jwtToken?.trim()) {
      headers['Authorization'] = `Bearer ${jwtToken.trim()}`;
    }

    const items: Array<{ name: string; category: string; price: number; sku: string; stock: number; description?: string }> = [];

    try {
      // 1. Fetch Categories API from WooCommerce / WordPress
      let categories: Array<{ id: number; name: string }> = [];
      try {
        const catRes = await (globalThis as any).fetch(`${baseUrl}/wp-json/wc/v3/products/categories?page=1&per_page=100&hide_empty=true`, { headers });
        if (catRes.ok) {
          const catData = await catRes.json();
          if (Array.isArray(catData)) {
            categories = catData.map((c: any) => ({ id: c.id, name: c.name || 'General' }));
          }
        }
      } catch (catErr: any) {
        console.log(`âš ï¸ WordPress Category fetch error: ${catErr.message}`);
      }

      if (categories.length === 0) {
        categories = [{ id: 44, name: 'Products' }, { id: 1, name: 'General' }];
      }

      // 2. Fetch Products per Category using custom pinaka-pos API
      for (const cat of categories) {
        try {
          const prodRes = await (globalThis as any).fetch(`${baseUrl}/wp-json/pinaka-pos/v1/products-by-category/${cat.id}`, { headers });
          if (prodRes.ok) {
            const rawData = await prodRes.json();
            const productList = Array.isArray(rawData) ? rawData : (rawData?.products || rawData?.data || []);
            
            for (const p of productList) {
              const name = p.name || p.title || p.post_title || 'Unnamed Item';
              const price = parseFloat(p.price || p.regular_price || p.sale_price || '0.00') || 0;
              const sku = p.sku || p.id?.toString() || `ITEM-${Math.floor(Math.random()*10000)}`;
              const stock = parseInt(p.stock_quantity || p.stock || p.quantity || '50', 10) || 50;
              const description = p.description || p.short_description || `Imported from ${baseUrl}`;
              
              items.push({
                name,
                category: cat.name || p.category || 'Retail',
                price,
                sku: String(sku),
                stock,
                description,
              });
            }
          }
        } catch (e: any) {
          console.log(`âš ï¸ Category ${cat.id} product fetch warning: ${e.message}`);
        }
      }

      // 3. Fallback to WooCommerce standard products API if custom endpoint was empty
      if (items.length === 0) {
        try {
          const directRes = await (globalThis as any).fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=100`, { headers });
          if (directRes.ok) {
            const rawProds = await directRes.json();
            if (Array.isArray(rawProds)) {
              for (const p of rawProds) {
                items.push({
                  name: p.name || 'Product',
                  category: p.categories?.[0]?.name || 'General',
                  price: parseFloat(p.price || '0') || 0,
                  sku: p.sku || p.id?.toString() || `SKU-WC-${p.id}`,
                  stock: p.stock_quantity || 50,
                  description: p.description || '',
                });
              }
            }
          }
        } catch (dirErr: any) {
          console.log(`âš ï¸ WooCommerce direct products fetch warning: ${dirErr.message}`);
        }
      }
    } catch (err: any) {
      console.log(`âš ï¸ WordPress Catalog Ingest Error: ${err.message}`);
    }

    // If WordPress API returns empty or unreachable, return sample products as fallback
    if (items.length === 0) {
      return [
        { name: 'Organic Red Apples (1kg)', category: 'Produce', price: 4.99, sku: 'PROD-APP-01', stock: 150 },
        { name: 'Whole Organic Milk (1 Gal)', category: 'Dairy', price: 5.49, sku: 'DAIRY-MLK-01', stock: 80 },
        { name: 'Artisan Sourdough Bread', category: 'Bakery', price: 6.29, sku: 'BAK-BRD-01', stock: 45 },
        { name: 'Avocado Pack (4ct)', category: 'Produce', price: 3.99, sku: 'PROD-AVO-04', stock: 120 },
        { name: 'Greek Yogurt Vanilla 32oz', category: 'Dairy', price: 4.79, sku: 'DAIRY-YOG-01', stock: 60 },
        { name: 'Organic Chicken Breast 1lb', category: 'Meat', price: 8.99, sku: 'MEAT-CHK-01', stock: 35 },
        { name: 'Atlantic Salmon Fillet 1lb', category: 'Seafood', price: 12.99, sku: 'SEA-SLM-01', stock: 25 },
        { name: 'Sparkling Mineral Water 12pk', category: 'Beverages', price: 7.99, sku: 'BEV-WTR-12', stock: 90 },
        { name: 'Organic Extra Virgin Olive Oil', category: 'Pantry', price: 14.49, sku: 'PAN-OIL-01', stock: 50 },
        { name: 'Fair Trade Dark Chocolate Bar', category: 'Snacks', price: 3.49, sku: 'SNK-CHO-01', stock: 200 },
      ];
    }

    return items;
  }

  async syncStoreCatalogFromWordPress(params: {
    merchantId: string;
    storeId: string;
    wordpressUrl: string;
    wordpressJwt: string;
  }): Promise<{ categoryCount: number; productCount: number }> {
    const categories = await this.fetchWordPressCategoryCatalog(params.wordpressUrl, params.wordpressJwt);
    let productCount = 0;
    for (const node of categories) {
      if (!Number.isFinite(Number(node.id))) continue;
      const savedCategory = await this.upsertStoreCategory(params.merchantId, params.storeId, node);
      const products = Array.isArray(node.products) ? node.products : [];
      for (const product of products) {
        if (!Number.isFinite(Number(product.id))) continue;
        await this.upsertStoreProduct(params.merchantId, params.storeId, savedCategory, product);
        productCount += 1;
      }
    }
    return { categoryCount: categories.length, productCount };
  }

  async getStoreCatalog(storeId: string): Promise<{ categories: CategoryEntity[]; products: ProductEntity[] }> {
    const [categories, products] = await Promise.all([
      this.categoryRepo.find({ where: { storeId }, order: { name: 'ASC' } }),
      this.productRepo.find({ where: { storeId }, order: { name: 'ASC' } }),
    ]);
    return { categories, products };
  }

  private async fetchWordPressCategoryCatalog(
    wordpressUrl: string,
    wordpressJwt: string,
  ): Promise<WordPressCategoryNode[]> {
    const baseUrl = wordpressUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/wp-json/pinaka-pos/v1/categories/get-categories-products`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${wordpressJwt}` },
    });
    if (!response.ok) {
      throw new BadRequestException(
        `WordPress catalog API returned HTTP ${response.status}. Check the site URL and JWT token.`,
      );
    }
    const body = (await response.json()) as { status?: string; category?: WordPressCategoryNode[] };
    const roots = Array.isArray(body.category) ? body.category : [];
    if (!roots.length) {
      throw new BadRequestException('WordPress catalog API returned no categories');
    }
    return this.flattenWordPressCategories(roots);
  }

  private flattenWordPressCategories(nodes: WordPressCategoryNode[]): WordPressCategoryNode[] {
    const flattened: WordPressCategoryNode[] = [];
    const walk = (items: WordPressCategoryNode[]) => {
      for (const item of items) {
        flattened.push(item);
        if (Array.isArray(item.children) && item.children.length) walk(item.children);
      }
    };
    walk(nodes);
    return flattened;
  }

  private async upsertStoreCategory(
    merchantId: string,
    storeId: string,
    node: WordPressCategoryNode,
  ): Promise<CategoryEntity> {
    const wordpressId = Number(node.id);
    const categoryJson = { ...node };
    delete categoryJson.products;
    delete categoryJson.children;
    const fields = {
      merchantId,
      storeId,
      wordpressId,
      parentWordpressId: Number(node.parent || 0),
      name: String(node.name || '').trim() || `Category ${wordpressId}`,
      slug: String(node.slug || ''),
      description: String(node.description || ''),
      productCount: Number(node.count || 0),
      image: node.image ? String(node.image) : null,
      posTaxClass: String(node.pos_tax_class || ''),
      posTaxPercent: String(node.pos_tax_percent || ''),
      payload: categoryJson as Record<string, unknown>,
      updatedAt: new Date(),
    };
    const existing = await this.categoryRepo.findOneBy({ storeId, wordpressId });
    return this.categoryRepo.save(existing ? Object.assign(existing, fields) : this.categoryRepo.create(fields));
  }

  private async upsertStoreProduct(
    merchantId: string,
    storeId: string,
    category: CategoryEntity,
    product: WordPressProductNode,
  ): Promise<ProductEntity> {
    const wordpressId = Number(product.id);
    const priceRaw = product.price === undefined || product.price === null || String(product.price).trim() === ''
      ? null
      : String(Number.parseFloat(String(product.price)));
    const fields = {
      merchantId,
      storeId,
      categoryId: category.id,
      wordpressId,
      wordpressCategoryId: category.wordpressId,
      name: String(product.name || '').trim() || `Product ${wordpressId}`,
      price: Number.isFinite(Number(priceRaw)) ? priceRaw : null,
      image: product.image ? String(product.image) : null,
      tags: Array.isArray(product.tags) ? product.tags : [],
      payload: product as Record<string, unknown>,
      updatedAt: new Date(),
    };
    const existing = await this.productRepo.findOneBy({
      storeId,
      wordpressId,
      wordpressCategoryId: category.wordpressId,
    });
    return this.productRepo.save(existing ? Object.assign(existing, fields) : this.productRepo.create(fields));
  }


  // --- Master Reference Data: store_types CRUD Methods ---

  private async seedDefaultStoreTypes(): Promise<void> {
    if (!this.storeTypeRepo) return;
    try {
      const count = await this.storeTypeRepo.count();
      if (count === 0) {
        const defaults = [
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000001', storeTypeCode: 'RETAIL', name: 'General Retail', description: 'Specialty retail, apparel, electronics and merchandise stores', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000002', storeTypeCode: 'GROCERY', name: 'Grocery & Supermarket', description: 'Supermarkets, organic food markets, and grocery chains', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000003', storeTypeCode: 'RESTAURANT', name: 'Restaurant & Cafe', description: 'Full service dining, quick-service (QSR), bakeries, and cafes', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000004', storeTypeCode: 'LIQUOR', name: 'Liquor & Beverages', description: 'Wine, beer, spirits, and beverage specialty shops', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000005', storeTypeCode: 'CONVENIENCE', name: 'Convenience Store', description: 'Corner markets, mini-marts, and 24/7 convenience retailers', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000006', storeTypeCode: 'FUEL', name: 'Gas Station & Forecourt', description: 'Fuel stations with integrated retail convenience shops', status: StoreTypeStatus.ACTIVE },
          { id: 'a1b2c3d4-e5f6-4a1b-8c2d-000000000007', storeTypeCode: 'KIOSK', name: 'Kiosk & Pop-Up', description: 'Self-service kiosks, food trucks, and seasonal pop-ups', status: StoreTypeStatus.ACTIVE },
        ];
        for (const item of defaults) {
          const entity = this.storeTypeRepo.create(item);
          await this.storeTypeRepo.save(entity);
        }
        console.log('🏪 [Master Data] Seeded 7 default store vertical types into store_types');
      }
    } catch (err: any) {
      console.warn('⚠️ [StoreType Seed Warning] ' + err.message);
    }
  }

  async listStoreTypes(status?: string): Promise<StoreTypeEntity[]> {
    if (!this.storeTypeRepo) return [];
    if (status) {
      return this.storeTypeRepo.find({ where: { status: status.toUpperCase() as StoreTypeStatus }, order: { name: 'ASC' } });
    }
    return this.storeTypeRepo.find({ order: { name: 'ASC' } });
  }

  async getStoreTypeByIdOrCode(idOrCode: string): Promise<StoreTypeEntity | null> {
    if (!this.storeTypeRepo || !idOrCode) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode.trim());
    if (isUuid) {
      const byId = await this.storeTypeRepo.findOneBy({ id: idOrCode.trim() });
      if (byId) return byId;
    }
    return this.storeTypeRepo.findOneBy({ storeTypeCode: idOrCode.trim().toUpperCase() });
  }

  async createStoreType(dto: CreateStoreTypeDto): Promise<StoreTypeEntity> {
    if (!this.storeTypeRepo) {
      throw new ServiceUnavailableException('Store types require PostgreSQL');
    }
    const entity = this.storeTypeRepo.create({
      storeTypeCode: dto.storeTypeCode.trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      status: dto.status || StoreTypeStatus.ACTIVE,
    });
    return this.storeTypeRepo.save(entity);
  }

  async updateStoreType(idOrCode: string, dto: UpdateStoreTypeDto): Promise<StoreTypeEntity | null> {
    const existing = await this.getStoreTypeByIdOrCode(idOrCode);
    if (!existing) return null;
    if (dto.storeTypeCode !== undefined) {
      const code = dto.storeTypeCode.trim().toUpperCase();
      const duplicate = await this.getStoreTypeByIdOrCode(code);
      if (duplicate && duplicate.id !== existing.id) throw new ConflictException(`Store type code '${code}' already exists`);
      existing.storeTypeCode = code;
    }
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.storeTypeRepo.save(existing);
  }

  async deleteStoreType(idOrCode: string): Promise<boolean> {
    const existing = await this.getStoreTypeByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.status = StoreTypeStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.storeTypeRepo.save(existing);
    return true;
  }


  // --- Master & Tenant Tables Methods ---

  private async seedAllMasterData(): Promise<void> {
    await this.seedDefaultFeatures();
    await this.seedDefaultRoleTemplates();
    await this.seedDefaultCommercialPlans();
  }

  private async seedDefaultFeatures(): Promise<void> {
    if (!this.featureRepo || !this.permissionRepo) return;
    try {
      if ((await this.featureRepo.count()) === 0) {
        const defaults = [
          { id: 'f1111111-0000-0000-0000-000000000001', featureKey: 'ORDER_MANAGEMENT', name: 'Order Management', description: 'Manage in-store POS and online delivery orders', category: 'OPERATIONS', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
          { id: 'f1111111-0000-0000-0000-000000000002', featureKey: 'REFUNDS', name: 'Refunds & Returns', description: 'Process full and partial order refunds', category: 'FINANCIAL', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
          { id: 'f1111111-0000-0000-0000-000000000003', featureKey: 'KDS', name: 'Kitchen Display System', description: 'Live kitchen prep tickets and bump bar tracking', category: 'KITCHEN', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
          { id: 'f1111111-0000-0000-0000-000000000004', featureKey: 'LOYALTY', name: 'Loyalty & Rewards', description: 'Earn and redeem loyalty points at checkout', category: 'MARKETING', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
          { id: 'f1111111-0000-0000-0000-000000000005', featureKey: 'SAFE_DROP', name: 'Safe Drop & Cash Management', description: 'Mid-shift safe drops and drawer reconciliations', category: 'FINANCIAL', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
          { id: 'f1111111-0000-0000-0000-000000000006', featureKey: 'INVENTORY', name: 'Live Stock Tracking', description: 'Real-time multi-location inventory deduction', category: 'INVENTORY', featureType: 'FLAG', status: FeatureStatus.ACTIVE },
        ];
        for (const item of defaults) {
          await this.featureRepo.save(this.featureRepo.create(item));
        }

        const permDefaults = [
          { id: 'p1111111-0000-0000-0000-000000000001', featureId: 'f1111111-0000-0000-0000-000000000001', permissionKey: 'ORDERS_CREATE', name: 'Create Orders', description: 'Create new POS cart and ring items', status: PermissionStatus.ACTIVE },
          { id: 'p1111111-0000-0000-0000-000000000002', featureId: 'f1111111-0000-0000-0000-000000000002', permissionKey: 'REFUNDS_PROCESS', name: 'Process Refunds', description: 'Issue cash or card refunds', status: PermissionStatus.ACTIVE },
          { id: 'p1111111-0000-0000-0000-000000000003', featureId: 'f1111111-0000-0000-0000-000000000003', permissionKey: 'KDS_VIEW', name: 'View KDS', description: 'View kitchen queue and bump tickets', status: PermissionStatus.ACTIVE },
          { id: 'p1111111-0000-0000-0000-000000000004', featureId: 'f1111111-0000-0000-0000-000000000004', permissionKey: 'LOYALTY_APPLY', name: 'Apply Loyalty Points', description: 'Look up customers and apply points', status: PermissionStatus.ACTIVE },
          { id: 'p1111111-0000-0000-0000-000000000005', featureId: 'f1111111-0000-0000-0000-000000000005', permissionKey: 'CASH_SAFE_DROP', name: 'Perform Safe Drop', description: 'Transfer cash from drawer to safe', status: PermissionStatus.ACTIVE },
        ];
        for (const perm of permDefaults) {
          await this.permissionRepo.save(this.permissionRepo.create(perm));
        }
      }
    } catch {}
  }

  private async seedDefaultRoleTemplates(): Promise<void> {
    if (!this.roleTemplateRepo) return;
    try {
      if ((await this.roleTemplateRepo.count()) === 0) {
        const defaults = [
          { id: 'r1111111-0000-0000-0000-000000000001', roleCode: 'CASHIER', name: 'POS Cashier', description: 'Point of sale order ringing, payments, and receipt printing', scopeType: RoleScopeType.STORE, status: RoleTemplateStatus.ACTIVE },
          { id: 'r1111111-0000-0000-0000-000000000002', roleCode: 'STORE_MANAGER', name: 'Store Manager', description: 'Full store operational control, shift closing, safe drops, and refunds', scopeType: RoleScopeType.STORE, status: RoleTemplateStatus.ACTIVE },
          { id: 'r1111111-0000-0000-0000-000000000003', roleCode: 'KITCHEN_STAFF', name: 'Kitchen Staff', description: 'Kitchen display system viewer and ticket status manager', scopeType: RoleScopeType.STORE, status: RoleTemplateStatus.ACTIVE },
          { id: 'r1111111-0000-0000-0000-000000000004', roleCode: 'MERCHANT_ADMIN', name: 'Merchant Administrator', description: 'Enterprise tenant owner with full access across all merchant stores', scopeType: RoleScopeType.MERCHANT, status: RoleTemplateStatus.ACTIVE },
        ];
        for (const item of defaults) {
          await this.roleTemplateRepo.save(this.roleTemplateRepo.create(item));
        }
      }
    } catch {}
  }

  private async seedDefaultCommercialPlans(): Promise<void> {
    if (!this.planMasterRepo) return;
    if (!this.planMasterRepo) return;
    try {
      if ((await this.planMasterRepo.count()) === 0) {
        const defaults = [
          { id: 'b1111111-0000-0000-0000-000000000001', planCode: 'STARTER', name: 'Starter Plan', description: 'Essential cloud POS for single-location small retailers', billingModel: PlanBillingModel.FLAT, basePrice: 29.00, currency: 'USD', billingCycle: PlanBillingCycle.MONTHLY, status: PlanStatus.ACTIVE },
          { id: 'b1111111-0000-0000-0000-000000000002', planCode: 'PRO', name: 'Professional Plan', description: 'Advanced multi-terminal POS with KDS and delivery aggregator sync', billingModel: PlanBillingModel.PER_STORE, basePrice: 79.00, currency: 'USD', billingCycle: PlanBillingCycle.MONTHLY, status: PlanStatus.ACTIVE },
          { id: 'b1111111-0000-0000-0000-000000000003', planCode: 'ENTERPRISE', name: 'Enterprise Suite', description: 'Unlimited stores, custom roles, API integrations, and 24/7 SLA', billingModel: PlanBillingModel.CUSTOM, basePrice: 199.00, currency: 'USD', billingCycle: PlanBillingCycle.MONTHLY, status: PlanStatus.ACTIVE },
        ];
        for (const item of defaults) {
          await this.planMasterRepo.save(this.planMasterRepo.create(item));
        }
      }
    } catch {}
  }

  // --- Features CRUD ---
  async listFeatures(status?: string, category?: string): Promise<FeatureEntity[]> {
    if (!this.featureRepo) return [];
    const where: any = {};
    if (status) where.status = status.toUpperCase();
    if (category) where.category = category.toUpperCase();
    return this.featureRepo.find({ where, order: { name: 'ASC' } });
  }

  async getFeatureByIdOrKey(idOrKey: string): Promise<FeatureEntity | null> {
    if (!this.featureRepo || !idOrKey) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey.trim());
    if (isUuid) {
      const byId = await this.featureRepo.findOneBy({ id: idOrKey.trim() });
      if (byId) return byId;
    }
    return this.featureRepo.findOneBy({ featureKey: idOrKey.trim().toUpperCase() });
  }

  async createFeature(dto: CreateFeatureDto): Promise<FeatureEntity> {
    const entity = this.featureRepo.create({
      featureKey: dto.featureKey.trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      category: dto.category.trim().toUpperCase(),
      featureType: dto.featureType || 'TEXT',
      status: dto.status || FeatureStatus.ACTIVE,
    });
    return this.featureRepo.save(entity);
  }

  async updateFeature(idOrKey: string, dto: UpdateFeatureDto): Promise<FeatureEntity | null> {
    const existing = await this.getFeatureByIdOrKey(idOrKey);
    if (!existing) return null;
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.category !== undefined) existing.category = dto.category.trim().toUpperCase();
    if (dto.featureType !== undefined) existing.featureType = dto.featureType;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.featureRepo.save(existing);
  }

  async deleteFeature(idOrKey: string): Promise<boolean> {
    const existing = await this.getFeatureByIdOrKey(idOrKey);
    if (!existing) return false;
    existing.status = FeatureStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.featureRepo.save(existing);
    return true;
  }

  // --- Permissions CRUD ---
  async listPermissions(featureId?: string, status?: string): Promise<PermissionEntity[]> {
    if (!this.permissionRepo) return [];
    const where: any = {};
    if (featureId) where.featureId = featureId;
    if (status) where.status = status.toUpperCase();
    return this.permissionRepo.find({ where, order: { name: 'ASC' } });
  }

  async getPermissionByIdOrKey(idOrKey: string): Promise<PermissionEntity | null> {
    if (!this.permissionRepo || !idOrKey) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey.trim());
    if (isUuid) {
      const byId = await this.permissionRepo.findOneBy({ id: idOrKey.trim() });
      if (byId) return byId;
    }
    return this.permissionRepo.findOneBy({ permissionKey: idOrKey.trim().toUpperCase() });
  }

  async createPermission(dto: CreatePermissionDto): Promise<PermissionEntity> {
    let targetFeatureId = dto.featureId;
    const feat = await this.getFeatureByIdOrKey(dto.featureId);
    if (feat) {
      targetFeatureId = feat.id;
    }
    const entity = this.permissionRepo.create({
      featureId: targetFeatureId,
      permissionKey: (dto.permissionKey || dto.key || '').trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      status: dto.status || PermissionStatus.ACTIVE,
    });
    return this.savePermission(entity);
  }

  private async savePermission(entity: PermissionEntity): Promise<PermissionEntity> {
    try {
      return await this.permissionRepo.save(entity);
    } catch (error) {
      const databaseError = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
      if (databaseError?.code === '23503' && databaseError.constraint === 'permissions_feature_fk') {
        throw new BadRequestException(`Feature '${entity.featureId}' does not exist. Use an existing featureId.`);
      }
      if (databaseError?.code === '23505') {
        throw new ConflictException(`Permission key '${entity.permissionKey}' already exists`);
      }
      throw error;
    }
  }

  async updatePermission(idOrKey: string, dto: UpdatePermissionDto): Promise<PermissionEntity | null> {
    const existing = await this.getPermissionByIdOrKey(idOrKey);
    if (!existing) return null;
    const newKey = (dto.permissionKey || dto.key)?.trim();
    if (newKey && newKey.toUpperCase() !== existing.permissionKey.toUpperCase()) {
      existing.permissionKey = newKey.toUpperCase();
    }
    if (dto.featureId !== undefined && String(dto.featureId).trim()) {
      const feat = await this.getFeatureByIdOrKey(String(dto.featureId).trim());
      if (feat) {
        existing.featureId = feat.id;
      } else {
        existing.featureId = String(dto.featureId).trim();
      }
    }
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.savePermission(existing);
  }

  async deletePermission(idOrKey: string): Promise<boolean> {
    const existing = await this.getPermissionByIdOrKey(idOrKey);
    if (!existing) return false;
    existing.status = PermissionStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.permissionRepo.save(existing);
    return true;
  }

  private permissionBulkItems(body: unknown, extraKeys: string[] = []): Record<string, unknown>[] {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Provide { items: [...] }');
    const payload = body as Record<string, unknown>;
    if (Object.keys(payload).some(key => key !== 'items' && !extraKeys.includes(key))) {
      throw new BadRequestException('Provide { items: [...] }');
    }
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
      throw new BadRequestException('items must contain between 1 and 100 permissions');
    }
    if (payload.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new BadRequestException('Each item must be a JSON object');
    }
    return payload.items as Record<string, unknown>[];
  }

  private permissionText(value: unknown, field: string, max: number, required = false): string | undefined {
    if (value === undefined || value === null) {
      if (required) throw new BadRequestException(`${field} is required`);
      return undefined;
    }
    if (typeof value !== 'string') throw new BadRequestException(`Invalid ${field}`);
    const text = value.trim();
    if (!text) {
      if (required) throw new BadRequestException(`${field} is required`);
      return '';
    }
    if (text.length > max) throw new BadRequestException(`Invalid ${field}`);
    return field === 'permissionKey' ? text.toUpperCase() : text;
  }

  private permissionStatusValue(value: unknown, required = false): PermissionStatus | undefined {
    if (value === undefined || value === null) {
      if (required) throw new BadRequestException('status is required');
      return undefined;
    }
    if (typeof value !== 'string') throw new BadRequestException('Invalid status');
    const status = value.trim().toUpperCase().replace(/\s+/g, '_');
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new BadRequestException('Invalid status');
    return status as PermissionStatus;
  }

  async createFeaturePermissions(featureId: string, body: unknown): Promise<{ success: true; count: number; permissions: PermissionEntity[] }> {
    if (!this.permissionRepo || !this.dataSource?.isInitialized) throw new ServiceUnavailableException('Master data requires PostgreSQL');
    await this.masterData('features', 'get', featureId);
    const skipExisting = (body as { skipExisting?: unknown })?.skipExisting === true;
    const prepared = this.permissionBulkItems(body, ['skipExisting']).map(item => {
      const allowed = ['permissionKey', 'name', 'description', 'status', 'featureId'];
      if (Object.keys(item).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown or immutable field');
      if (typeof item.featureId === 'string' && item.featureId.toLowerCase() !== featureId.toLowerCase()) {
        throw new BadRequestException('featureId must match the feature in the URL');
      }
      return {
        permissionKey: this.permissionText(item.permissionKey, 'permissionKey', 100, true)!,
        name: this.permissionText(item.name, 'name', 150, true)!,
        description: this.permissionText(item.description, 'description', 2000) ?? '',
        status: this.permissionStatusValue(item.status) || PermissionStatus.ACTIVE,
      };
    });
    const seen = new Set<string>();
    for (const item of prepared) {
      if (seen.has(item.permissionKey)) throw new BadRequestException('Duplicate permissionKey in items');
      seen.add(item.permissionKey);
    }
    try {
      return await this.dataSource.transaction(async manager => {
        const repo = manager.getRepository(PermissionEntity);
        const permissions: PermissionEntity[] = [];
        for (const item of prepared) {
          const existing = await repo.findOneBy({ permissionKey: item.permissionKey });
          if (existing) {
            if (skipExisting && existing.featureId.toLowerCase() === featureId.toLowerCase()) continue;
            throw new ConflictException(`Permission key '${item.permissionKey}' already exists`);
          }
          permissions.push(await repo.save(repo.create({ ...item, featureId })));
        }
        return { success: true as const, count: permissions.length, permissions };
      });
    } catch (error: any) {
      const code = error.driverError?.code || error.code;
      if (code === '23505') throw new ConflictException('Permission key already exists');
      if (code === '23503') throw new BadRequestException(`Feature '${featureId}' does not exist. Use an existing featureId.`);
      throw error;
    }
  }

  async updateFeaturePermissions(featureId: string, body: unknown): Promise<{ success: true; count: number; permissions: PermissionEntity[] }> {
    if (!this.permissionRepo || !this.dataSource?.isInitialized) throw new ServiceUnavailableException('Master data requires PostgreSQL');
    await this.masterData('features', 'get', featureId);
    const prepared = this.permissionBulkItems(body).map(item => {
      const allowed = ['id', 'permissionKey', 'name', 'description', 'status'];
      if (Object.keys(item).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown or immutable field');
      const id = typeof item.id === 'string' ? item.id.trim() : undefined;
      const permissionKey = this.permissionText(item.permissionKey, 'permissionKey', 100);
      if (!id && !permissionKey) throw new BadRequestException('Each item requires id or permissionKey');
      const name = this.permissionText(item.name, 'name', 150);
      const description = this.permissionText(item.description, 'description', 2000);
      const status = this.permissionStatusValue(item.status);
      if (name === undefined && description === undefined && status === undefined) {
        throw new BadRequestException('Provide at least one field to update');
      }
      return { id, permissionKey, name, description, status };
    });
    const seen = new Set<string>();
    for (const item of prepared) {
      const token = (item.id || item.permissionKey)!.toLowerCase();
      if (seen.has(token)) throw new BadRequestException('Duplicate permission in items');
      seen.add(token);
    }
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PermissionEntity);
      const permissions: PermissionEntity[] = [];
      for (const item of prepared) {
        const existing = item.id
          ? await repo.findOneBy({ id: item.id })
          : await repo.findOneBy({ permissionKey: item.permissionKey });
        if (!existing || existing.featureId.toLowerCase() !== featureId.toLowerCase()) {
          throw new NotFoundException(`Permission '${item.id || item.permissionKey}' not found`);
        }
        if (item.name !== undefined) existing.name = item.name;
        if (item.description !== undefined) existing.description = item.description;
        if (item.status !== undefined) existing.status = item.status;
        existing.updatedAt = new Date();
        permissions.push(await repo.save(existing));
      }
      return { success: true as const, count: permissions.length, permissions };
    });
  }

  // --- Role Templates CRUD ---
  async listRoleTemplates(scopeType?: string, status?: string): Promise<RoleTemplateEntity[]> {
    if (!this.roleTemplateRepo) return [];
    const where: any = {};
    if (scopeType) where.scopeType = scopeType.toUpperCase();
    if (status) where.status = status.toUpperCase();
    return this.roleTemplateRepo.find({ where, order: { name: 'ASC' } });
  }

  async getRoleTemplateByIdOrCode(idOrCode: string): Promise<RoleTemplateEntity | null> {
    if (!this.roleTemplateRepo || !idOrCode) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode.trim());
    if (isUuid) {
      const byId = await this.roleTemplateRepo.findOneBy({ id: idOrCode.trim() });
      if (byId) return byId;
    }
    return this.roleTemplateRepo.findOneBy({ roleCode: idOrCode.trim().toUpperCase() });
  }

  async createRoleTemplate(dto: CreateRoleTemplateDto): Promise<RoleTemplateEntity> {
    const entity = this.roleTemplateRepo.create({
      roleCode: dto.roleCode.trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      scopeType: dto.scopeType || RoleScopeType.STORE,
      status: dto.status || RoleTemplateStatus.ACTIVE,
    });
    return this.roleTemplateRepo.save(entity);
  }

  async updateRoleTemplate(idOrCode: string, dto: UpdateRoleTemplateDto): Promise<RoleTemplateEntity | null> {
    const existing = await this.getRoleTemplateByIdOrCode(idOrCode);
    if (!existing) return null;
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.scopeType !== undefined) existing.scopeType = dto.scopeType;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.roleTemplateRepo.save(existing);
  }

  async deleteRoleTemplate(idOrCode: string): Promise<boolean> {
    const existing = await this.getRoleTemplateByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.status = RoleTemplateStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.roleTemplateRepo.save(existing);
    return true;
  }

  // --- Commercial Plans CRUD ---
  async listPlans(status?: string): Promise<PlanEntity[]> {
    if (!this.planMasterRepo) return [];
    const where: any = {};
    if (status) where.status = status.toUpperCase();
    return this.planMasterRepo.find({ where, order: { basePrice: 'ASC' } });
  }

  async getPlanByIdOrCode(idOrCode: string): Promise<PlanEntity | null> {
    if (!this.planMasterRepo || !idOrCode) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode.trim());
    if (isUuid) {
      const byId = await this.planMasterRepo.findOneBy({ id: idOrCode.trim() });
      if (byId) return byId;
    }
    return this.planMasterRepo.findOneBy({ planCode: idOrCode.trim().toUpperCase() });
  }

  async createPlan(dto: CreatePlanDto): Promise<PlanEntity> {
    const entity = this.planMasterRepo.create({
      planCode: dto.planCode.trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      billingModel: dto.billingModel,
      basePrice: dto.basePrice,
      currency: dto.currency.trim().toUpperCase(),
      billingCycle: dto.billingCycle,
      storeType: dto.storeType?.trim().toUpperCase() || null,
      includedStores: dto.includedStores ?? 0,
      includedTerminals: dto.includedTerminals ?? 0,
      additionalTerminalPrice: dto.additionalTerminalPrice ?? 0,
      includedEmployees: dto.includedEmployees ?? 0,
      additionalEmployeePrice: dto.additionalEmployeePrice ?? 0,
      trialPeriod: dto.trialPeriod ?? 0,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
      includedFeatures: dto.includedFeatures ?? [],
      status: dto.status || PlanStatus.ACTIVE,
    });
    return this.planMasterRepo.save(entity);
  }

  async updatePlan(idOrCode: string, dto: UpdatePlanDto): Promise<PlanEntity | null> {
    const existing = await this.getPlanByIdOrCode(idOrCode);
    if (!existing) return null;
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.billingModel !== undefined) existing.billingModel = dto.billingModel;
    if (dto.basePrice !== undefined) existing.basePrice = dto.basePrice;
    if (dto.currency !== undefined) existing.currency = dto.currency.trim().toUpperCase();
    if (dto.billingCycle !== undefined) existing.billingCycle = dto.billingCycle;
    if (dto.storeType !== undefined) existing.storeType = dto.storeType?.trim().toUpperCase() || null;
    if (dto.includedStores !== undefined) existing.includedStores = dto.includedStores;
    if (dto.includedTerminals !== undefined) existing.includedTerminals = dto.includedTerminals;
    if (dto.additionalTerminalPrice !== undefined) existing.additionalTerminalPrice = dto.additionalTerminalPrice;
    if (dto.includedEmployees !== undefined) existing.includedEmployees = dto.includedEmployees;
    if (dto.additionalEmployeePrice !== undefined) existing.additionalEmployeePrice = dto.additionalEmployeePrice;
    if (dto.trialPeriod !== undefined) existing.trialPeriod = dto.trialPeriod;
    if (dto.effectiveFrom !== undefined) existing.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    if (dto.includedFeatures !== undefined) existing.includedFeatures = dto.includedFeatures;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.planMasterRepo.save(existing);
  }

  async deletePlan(idOrCode: string): Promise<boolean> {
    const existing = await this.getPlanByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.status = PlanStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.planMasterRepo.save(existing);
    return true;
  }

  // --- Roles (Tenant-specific) CRUD ---
  async listRoles(merchantId: string, status?: string): Promise<RoleEntity[]> {
    if (!this.roleRepo) return [];
    const where: any = { merchantId };
    if (status) where.status = status.toUpperCase();
    return this.roleRepo.find({ where, order: { name: 'ASC' } });
  }

  async getRoleByIdOrCode(merchantId: string, idOrCode: string): Promise<RoleEntity | null> {
    if (!this.roleRepo || !idOrCode) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode.trim());
    if (isUuid) {
      const byId = await this.roleRepo.findOneBy({ merchantId, id: idOrCode.trim() });
      if (byId) return byId;
    }
    return this.roleRepo.findOneBy({ merchantId, roleCode: idOrCode.trim().toUpperCase() });
  }

  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    if (!(await this.merchantRepo.existsBy({ id: dto.merchantId }))) throw new NotFoundException('Merchant not found');
    if (dto.sourceRoleTemplateId && !(await this.roleTemplateRepo.existsBy({ id: dto.sourceRoleTemplateId }))) {
      throw new BadRequestException('Source role template does not exist');
    }
    const entity = this.roleRepo.create({
      merchantId: dto.merchantId,
      sourceRoleTemplateId: dto.sourceRoleTemplateId || null,
      roleCode: dto.roleCode.trim().toUpperCase(),
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      scopeType: dto.scopeType || RoleScopeType.STORE,
      isCustom: dto.isCustom !== false,
      status: dto.status || RoleStatus.ACTIVE,
    });
    return this.dataSource.transaction(async manager => {
      try {
        const role = await manager.getRepository(RoleEntity).save(entity);
        if (role.sourceRoleTemplateId) {
          const merchantUuid = (await manager.query(
            'SELECT m.id FROM public.merchants m LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode" WHERE m."merchantId"=$1 OR m."merchantCode"=$1 OR m.id::text=$1 ORDER BY v.version ASC NULLS LAST,m."createdAt" LIMIT 1',
            [dto.merchantId],
          ))[0]?.id || null;
          await manager.query(`INSERT INTO public.role_permissions(role_id,permission_id,allowed,merchant_id)
            SELECT $1,permission_id,default_allowed,$3 FROM public.role_template_permissions WHERE role_template_id=$2`,
          [role.id, role.sourceRoleTemplateId, merchantUuid]);
        }
        return role;
      } catch (error: any) {
        if (error.driverError?.code === '23505') throw new ConflictException('Role code already exists for this merchant');
        throw error;
      }
    });
  }

  async updateRole(merchantId: string, idOrCode: string, dto: UpdateRoleDto): Promise<RoleEntity | null> {
    const existing = await this.getRoleByIdOrCode(merchantId, idOrCode);
    if (!existing) return null;
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.scopeType !== undefined) existing.scopeType = dto.scopeType;
    if (dto.isCustom !== undefined) existing.isCustom = dto.isCustom;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.roleRepo.save(existing);
  }

  async deleteRole(merchantId: string, idOrCode: string): Promise<boolean> {
    const existing = await this.getRoleByIdOrCode(merchantId, idOrCode);
    if (!existing) return false;
    existing.status = RoleStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.roleRepo.save(existing);
    return true;
  }

  private async requireMerchantRecord(idOrCode: string): Promise<{ merchantCode: string; merchantUuid: string }> {
    const rows = await this.dataSource.query(
      `SELECT m."merchantId" AS "merchantCode", m.id AS "merchantUuid"
       FROM public.merchants m LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode" WHERE m."merchantId"=$1 OR m."merchantCode"=$1 OR m.id::text=$1 ORDER BY v.version ASC NULLS LAST,m."createdAt" LIMIT 1`,
      [idOrCode],
    );
    if (!rows.length) throw new NotFoundException(`Merchant '${idOrCode}' not found`);
    return rows[0];
  }

  private async requireStoreRecord(merchantId: string, storeId: string): Promise<{ merchantCode: string; merchantUuid: string; storeUuid: string }> {
    const merchant = await this.requireMerchantRecord(merchantId);
    const rows = await this.dataSource.query(
      `SELECT id FROM public.stores WHERE (legacy_store_id=$2 OR id::text=$2) AND merchant_uuid=$1::uuid LIMIT 1`,
      [merchant.merchantUuid, storeId],
    );
    if (!rows.length) throw new NotFoundException(`Store '${storeId}' not found for merchant '${merchantId}'`);
    return { ...merchant, storeUuid: rows[0].id };
  }

  private async requireMerchantRole(merchantId: string, roleId: string): Promise<RoleEntity> {
    const { merchantCode } = await this.requireMerchantRecord(merchantId);
    const role = await this.getRoleByIdOrCode(merchantCode, roleId);
    if (!role) throw new NotFoundException(`Role '${roleId}' not found for merchant '${merchantId}'`);
    return role;
  }

  private storeRolePermissionProjection = `rp.id, rp.role_id AS "roleId", rp.permission_id AS "permissionId", rp.allowed,
            rp.merchant_id AS "merchantId", rp.store_id AS "storeId",
            p.permission_key AS "permissionKey", p.name AS "permissionName",
            rp.created_at AS "createdAt", rp.updated_at AS "updatedAt"`;

  async listMerchantRoleTemplates(merchantId: string, status?: string): Promise<MerchantRoleTemplateEntity[]> {
    if (!this.merchantRoleTemplateRepo) return [];
    const { merchantUuid } = await this.requireMerchantRecord(merchantId);
    const where: Record<string, string> = { merchantId: merchantUuid };
    if (status) where.status = status.toUpperCase();
    return this.merchantRoleTemplateRepo.find({ where, order: { name: 'ASC' } });
  }

  /** Master: role templates linked to a store type via store_type_role_templates. */
  async listRoleTemplatesForStoreType(
    storeTypeIdOrCode: string,
    options: { status?: string; defaultEnabled?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) {
      throw new ServiceUnavailableException('PostgreSQL is unavailable');
    }
    const storeTypes = await this.dataSource.query(
      `SELECT st.id FROM public.store_types st
       WHERE st.id::text=$1
          OR lower(COALESCE(to_jsonb(st)->>'store_type_code',to_jsonb(st)->>'storeTypeCode'))=lower($1)
       LIMIT 1`,
      [storeTypeIdOrCode],
    );
    if (!storeTypes[0]) throw new NotFoundException(`Store type '${storeTypeIdOrCode}' not found`);

    const params: unknown[] = [storeTypes[0].id];
    const filters: string[] = ['mapping.store_type_id = $1'];
    if (options.status) {
      params.push(options.status.toUpperCase());
      filters.push(`rt.status = $${params.length}`);
    }
    if (options.defaultEnabled !== undefined) {
      params.push(options.defaultEnabled);
      filters.push(`mapping.default_enabled = $${params.length}`);
    }

    return this.dataSource.query(
      `SELECT rt.id, rt.role_code AS "roleCode", rt.name, rt.description,
              rt.scope_type AS "scopeType", rt.status,
              mapping.id AS "mappingId",
              mapping.default_enabled AS "defaultEnabled",
              mapping.required,
              mapping.created_at AS "mappedAt"
       FROM public.store_type_role_templates mapping
       JOIN public.role_templates rt ON rt.id = mapping.role_template_id
       WHERE ${filters.join(' AND ')}
       ORDER BY rt.name`,
      params,
    );
  }

  /** Tenant: role templates saved for a merchant store. */
  async listStoreRoleTemplates(merchantId: string, storeId: string): Promise<Record<string, unknown>[]> {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) {
      throw new ServiceUnavailableException('PostgreSQL is unavailable');
    }
    const { merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    return this.dataSource.query(
      `SELECT srt.id, srt.merchant_id AS "merchantId", srt.store_id AS "storeId",
              srt.role_template_id AS "roleTemplateId", srt.enabled, srt.status,
              rt.role_code AS "roleCode", rt.name, rt.description,
              rt.scope_type AS "scopeType", rt.status AS "roleTemplateStatus",
              srt.created_at AS "createdAt", srt.updated_at AS "updatedAt"
       FROM public.store_role_templates srt
       JOIN public.role_templates rt ON rt.id = srt.role_template_id
       WHERE srt.merchant_id = $1::uuid AND srt.store_id = $2::uuid AND srt.status = 'ACTIVE'
       ORDER BY rt.name`,
      [merchantUuid, storeUuid],
    );
  }

  /**
   * Replace the set of role templates for a merchant store.
   * Each template must be mapped to the store's store type in store_type_role_templates.
   * Also ensures a merchant `roles` row exists (source_role_template_id) for workforce assignment.
   */
  async saveStoreRoleTemplates(
    merchantId: string,
    storeId: string,
    body: { roleTemplateIds: string[]; enabled?: boolean },
  ): Promise<Record<string, unknown>[]> {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) {
      throw new ServiceUnavailableException('PostgreSQL is unavailable');
    }
    const { merchantCode, merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    const enabled = body.enabled !== false;
    const ids = [...new Set((body.roleTemplateIds || []).map(id => id.trim().toLowerCase()))];

    const stores = await this.dataSource.query(
      `SELECT COALESCE(to_jsonb(s)->>'store_type_id', to_jsonb(s)->>'storeType') AS "storeType"
       FROM public.stores s WHERE s.id = $1::uuid LIMIT 1`,
      [storeUuid],
    );
    const storeTypeValue = stores[0]?.storeType;
    if (!storeTypeValue) throw new BadRequestException('Store does not have a store type');

    const storeTypes = await this.dataSource.query(
      `SELECT st.id FROM public.store_types st
       WHERE st.id::text=$1
          OR lower(COALESCE(to_jsonb(st)->>'store_type_code',to_jsonb(st)->>'storeTypeCode'))=lower($1)
       LIMIT 1`,
      [String(storeTypeValue)],
    );
    if (!storeTypes[0]) throw new BadRequestException(`Store type '${storeTypeValue}' is not configured`);
    const storeTypeId = String(storeTypes[0].id);

    if (ids.length) {
      const allowed = await this.dataSource.query(
        `SELECT role_template_id::text AS id
         FROM public.store_type_role_templates
         WHERE store_type_id = $1::uuid AND role_template_id = ANY($2::uuid[])`,
        [storeTypeId, ids],
      );
      const allowedSet = new Set(allowed.map((row: { id: string }) => row.id.toLowerCase()));
      const invalid = ids.filter(id => !allowedSet.has(id));
      if (invalid.length) {
        throw new BadRequestException(
          `Role template(s) not mapped to this store type: ${invalid.join(', ')}`,
        );
      }
    }

    await this.dataSource.transaction(async manager => {
      await manager.query(
        `DELETE FROM public.store_role_templates
         WHERE merchant_id = $1::uuid AND store_id = $2::uuid`,
        [merchantUuid, storeUuid],
      );

      for (const roleTemplateId of ids) {
        const templates = await manager.query(
          `SELECT id, role_code AS "roleCode", name, description, scope_type AS "scopeType", status
           FROM public.role_templates WHERE id = $1::uuid LIMIT 1`,
          [roleTemplateId],
        );
        if (!templates[0] || templates[0].status !== 'ACTIVE') {
          throw new BadRequestException(`Role template '${roleTemplateId}' is missing or inactive`);
        }

        await manager.query(
          `INSERT INTO public.store_role_templates
             (merchant_id, store_id, role_template_id, enabled, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'ACTIVE')`,
          [merchantUuid, storeUuid, roleTemplateId, enabled],
        );

        // Ensure merchant role exists so employees can be assigned later.
        const existingRole = await manager.query(
          `SELECT id FROM public.roles
           WHERE merchant_id = $1 AND source_role_template_id = $2::uuid LIMIT 1`,
          [merchantCode, roleTemplateId],
        );
        if (!existingRole[0]) {
          await manager.query(
            `INSERT INTO public.roles
               (merchant_id, source_role_template_id, role_code, name, description, scope_type, is_custom, status)
             VALUES ($1, $2::uuid, $3, $4, $5, $6, false, 'ACTIVE')
             ON CONFLICT (merchant_id, role_code) DO UPDATE
               SET source_role_template_id = EXCLUDED.source_role_template_id,
                   name = EXCLUDED.name,
                   description = EXCLUDED.description,
                   status = 'ACTIVE',
                   updated_at = now()`,
            [
              merchantCode,
              roleTemplateId,
              templates[0].roleCode,
              templates[0].name,
              templates[0].description || '',
              templates[0].scopeType || 'STORE',
            ],
          );
        }
      }
    });

    return this.listStoreRoleTemplates(merchantId, storeId);
  }

  async getMerchantRoleTemplate(merchantId: string, idOrCode: string): Promise<MerchantRoleTemplateEntity | null> {
    if (!this.merchantRoleTemplateRepo || !idOrCode) return null;
    const { merchantUuid } = await this.requireMerchantRecord(merchantId);
    const trimmed = idOrCode.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      const byId = await this.merchantRoleTemplateRepo.findOneBy({ merchantId: merchantUuid, id: trimmed });
      if (byId) return byId;
    }
    return this.merchantRoleTemplateRepo.findOneBy({ merchantId: merchantUuid, roleCode: trimmed.toUpperCase() });
  }

  async createMerchantRoleTemplate(merchantId: string, dto: CreateMerchantRoleTemplateDto): Promise<MerchantRoleTemplateEntity> {
    const { merchantUuid } = await this.requireMerchantRecord(merchantId);
    let source: RoleTemplateEntity | null = null;
    if (dto.sourceRoleTemplateId) {
      source = await this.getRoleTemplateByIdOrCode(dto.sourceRoleTemplateId);
      if (!source) throw new BadRequestException('Source role template does not exist');
    }
    const roleCode = (dto.roleCode || source?.roleCode || '').trim().toUpperCase();
    if (!roleCode) throw new BadRequestException('roleCode or sourceRoleTemplateId is required');
    const name = (dto.name || source?.name || '').trim();
    if (!name) throw new BadRequestException('name or sourceRoleTemplateId is required');
    const existing = await this.merchantRoleTemplateRepo.findOneBy({ merchantId: merchantUuid, roleCode });
    if (existing) throw new ConflictException(`Role code '${roleCode}' already exists for this merchant`);
    try {
      return await this.merchantRoleTemplateRepo.save(this.merchantRoleTemplateRepo.create({
        merchantId: merchantUuid,
        sourceRoleTemplateId: source?.id || null,
        roleCode,
        name,
        description: dto.description?.trim() ?? source?.description ?? '',
        scopeType: dto.scopeType || source?.scopeType || RoleScopeType.STORE,
        status: dto.status || RoleTemplateStatus.ACTIVE,
      }));
    } catch (error: any) {
      if (error.driverError?.code === '23505') throw new ConflictException(`Role code '${roleCode}' already exists for this merchant`);
      throw error;
    }
  }

  async updateMerchantRoleTemplate(merchantId: string, idOrCode: string, dto: UpdateMerchantRoleTemplateDto): Promise<MerchantRoleTemplateEntity | null> {
    const existing = await this.getMerchantRoleTemplate(merchantId, idOrCode);
    if (!existing) return null;
    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) existing.description = dto.description.trim();
    if (dto.scopeType !== undefined) existing.scopeType = dto.scopeType;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.merchantRoleTemplateRepo.save(existing);
  }

  async deleteMerchantRoleTemplate(merchantId: string, idOrCode: string): Promise<boolean> {
    const existing = await this.getMerchantRoleTemplate(merchantId, idOrCode);
    if (!existing) return false;
    existing.status = RoleTemplateStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.merchantRoleTemplateRepo.save(existing);
    return true;
  }

  async listStoreRolePermissions(merchantId: string, storeId: string, roleId: string): Promise<Record<string, unknown>[]> {
    const { merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    const role = await this.requireMerchantRole(merchantId, roleId);
    return this.dataSource.query(
      `SELECT ${this.storeRolePermissionProjection}
       FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
       WHERE rp.role_id=$1 AND rp.merchant_id=$2 AND rp.store_id=$3
       ORDER BY p.permission_key`,
      [role.id, merchantUuid, storeUuid],
    );
  }

  async getStoreRolePermission(merchantId: string, storeId: string, roleId: string, permissionId: string): Promise<Record<string, unknown> | null> {
    const { merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    const role = await this.requireMerchantRole(merchantId, roleId);
    const permission = await this.getPermissionByIdOrKey(permissionId);
    if (!permission) return null;
    const rows = await this.dataSource.query(
      `SELECT ${this.storeRolePermissionProjection}
       FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
       WHERE rp.role_id=$1 AND rp.permission_id=$2 AND rp.merchant_id=$3 AND rp.store_id=$4`,
      [role.id, permission.id, merchantUuid, storeUuid],
    );
    return rows[0] || null;
  }

  async upsertStoreRolePermission(merchantId: string, storeId: string, roleId: string, permissionId: string, allowed: boolean): Promise<Record<string, unknown>> {
    const { merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    const role = await this.requireMerchantRole(merchantId, roleId);
    const permission = await this.getPermissionByIdOrKey(permissionId);
    if (!permission) throw new NotFoundException(`Permission '${permissionId}' not found`);
    const rows = await this.dataSource.query(
      `INSERT INTO public.role_permissions(role_id,permission_id,allowed,merchant_id,store_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (role_id,permission_id,store_id) WHERE store_id IS NOT NULL
       DO UPDATE SET allowed=EXCLUDED.allowed, merchant_id=EXCLUDED.merchant_id, updated_at=now()
       RETURNING id`,
      [role.id, permission.id, allowed, merchantUuid, storeUuid],
    );
    const [item] = await this.dataSource.query(
      `SELECT ${this.storeRolePermissionProjection}
       FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
       WHERE rp.id=$1`,
      [rows[0].id],
    );
    return item;
  }

  async upsertStoreRolePermissionsBulk(merchantId: string, storeId: string, roleId: string, items: CreateStoreRolePermissionDto[]): Promise<Record<string, unknown>[]> {
    const seen = new Set<string>();
    const saved = [];
    for (const item of items) {
      if (seen.has(item.permissionId)) throw new BadRequestException('Duplicate permissionId in items');
      seen.add(item.permissionId);
      saved.push(await this.upsertStoreRolePermission(merchantId, storeId, roleId, item.permissionId, item.allowed !== false));
    }
    return saved;
  }

  async deleteStoreRolePermission(merchantId: string, storeId: string, roleId: string, permissionId: string): Promise<boolean> {
    const { merchantUuid, storeUuid } = await this.requireStoreRecord(merchantId, storeId);
    const role = await this.requireMerchantRole(merchantId, roleId);
    const permission = await this.getPermissionByIdOrKey(permissionId);
    if (!permission) return false;
    const result = await this.dataSource.query(
      `DELETE FROM public.role_permissions
       WHERE role_id=$1 AND permission_id=$2 AND merchant_id=$3 AND store_id=$4
       RETURNING id`,
      [role.id, permission.id, merchantUuid, storeUuid],
    );
    return result.length > 0;
  }

  // --- Employees (Tenant-specific) CRUD ---
  async listEmployees(merchantId?: string, status?: string): Promise<Record<string, unknown>[]> {
    if (!this.employeeRepo) return [];
    const where: any = {};
    if (merchantId) where.merchantId = merchantId;
    if (status) where.status = status.toUpperCase();
    const employees = await this.employeeRepo.find({ where, order: { firstName: 'ASC' } });
    return Promise.all(employees.map(employee => this.employeeDetails(employee)));
  }

  async getEmployeeDetails(merchantId: string | undefined, idOrCode: string): Promise<Record<string, unknown> | null> {
    const employee = await this.getEmployeeByIdOrCode(merchantId, idOrCode);
    return employee ? this.employeeDetails(employee) : null;
  }

  private async employeeDetails(employee: EmployeeEntity): Promise<Record<string, unknown>> {
    const users = employee.userId ? await this.dataSource.query('SELECT username FROM public.users WHERE id=$1', [employee.userId]) : [];
    const merchants = await this.dataSource.query(
      `SELECT "merchantCode",
              COALESCE(to_jsonb(m)->>'businessName', to_jsonb(m)->>'business_name', to_jsonb(m)->>'legalBusinessName') AS "merchantName"
       FROM public.merchants m WHERE id=$1`,
      [employee.merchantId],
    );
    const { loginPinHash: _loginPinHash, passwordHash: _passwordHash, ...details } = employee as EmployeeEntity & { loginPinHash?: unknown; passwordHash?: unknown };
    return {
      ...details,
      merchantCode: merchants[0]?.merchantCode || null,
      merchantName: merchants[0]?.merchantName || null,
      username: users[0]?.username || null,
    };
  }

  async getEmployeeByIdOrCode(merchantId: string | undefined, idOrCode: string): Promise<EmployeeEntity | null> {
    if (!this.employeeRepo || !idOrCode) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode.trim());
    if (isUuid) {
      const byId = await this.employeeRepo.findOneBy(merchantId ? { merchantId, id: idOrCode.trim() } : { id: idOrCode.trim() });
      if (byId) return byId;
    }
    const matches = await this.employeeRepo.find({
      where: merchantId ? { merchantId, employeeCode: idOrCode.trim().toUpperCase() } : { employeeCode: idOrCode.trim().toUpperCase() },
      take: 2,
    });
    if (matches.length > 1) throw new ConflictException(`Employee code '${idOrCode}' exists for more than one merchant; use the employee UUID`);
    return matches[0] || null;
  }

  async createEmployee(dto: CreateEmployeeDto): Promise<EmployeeEntity> {
    if (!(await this.merchantRepo.existsBy({ uuid: dto.merchantId }))) throw new NotFoundException('Merchant not found');
    try {
      return await this.dataSource.transaction(async manager => {
        const employeeRepo = manager.getRepository(EmployeeEntity);
        const email = dto.email.trim().toLowerCase();
        const username = dto.username.trim().toLowerCase();
        const duplicate = await manager.query('SELECT 1 FROM public.users WHERE lower(email)=lower($1) OR lower(username)=lower($2) LIMIT 1', [email, username]);
        if (duplicate.length) throw new ConflictException('Employee email or username already exists');
        const employeeCode = dto.employeeCode?.trim()
          ? dto.employeeCode.trim().toUpperCase()
          : await this.nextEmployeeCode(manager, dto.merchantId!);
        if (await manager.getRepository(EmployeeEntity).existsBy({ merchantId: dto.merchantId, employeeCode })) {
          throw new ConflictException(`Employee code '${employeeCode}' already exists for this merchant`);
        }
        const employee = await employeeRepo.save(employeeRepo.create({
          merchantId: dto.merchantId, employeeCode,
          firstName: dto.firstName.trim(), lastName: dto.lastName?.trim() || '', email,
          phone: dto.phone?.trim() || null, dateOfBirth: dto.dateOfBirth || null,
          gender: dto.gender?.trim() || null, addressLine1: dto.addressLine1?.trim() || '',
          addressLine2: dto.addressLine2?.trim() || '', city: dto.city?.trim() || '',
          state: dto.state?.trim() || '', postalCode: dto.postalCode?.trim() || '', country: dto.country?.trim() || '',
          loginPinHash: dto.loginPin ? this.hashEmployeePin(dto.loginPin) : null, sendCredentials: dto.sendCredentials ?? true,
          status: dto.status || EmployeeStatus.ACTIVE,
        }));
        const account = await manager.query(
          `SELECT u."accountId" FROM public.merchants m LEFT JOIN public.users u ON lower(u.email)=lower(m.email)
           WHERE m.id=$1::uuid LIMIT 1`, [dto.merchantId],
        );
        const [user] = await manager.query(
          `INSERT INTO public.users("accountId","firstName","lastName",email,"phoneNumber",role,"notificationEnabled",status,"passwordHash",username,"merchantId","employeeId")
           VALUES($1,$2,$3,$4,$5,'USER',true,$6,$7,$8,$9,$10) RETURNING id`,
          [account[0]?.accountId || null, employee.firstName, employee.lastName, email, employee.phone || '',
            employee.status === EmployeeStatus.ACTIVE ? 'ACTIVE' : 'DISABLED', this.hashUserPassword(dto.temporaryPassword),
            username, dto.merchantId, employee.id],
        );
        employee.userId = user.id;
        await employeeRepo.save(employee);
        if (dto.storeAssignments) {
          await this.syncEmployeeAssignmentsWithManager(manager, dto.merchantId!, employee.id, dto.storeAssignments);
        }
        return employee;
      });
    } catch (error: any) {
      if (error instanceof ConflictException || error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      if ((error.driverError?.code || error.code) === '23505') throw new ConflictException('Employee code, email, or username already exists');
      throw error;
    }
  }

  async updateEmployee(merchantId: string | undefined, idOrCode: string, dto: UpdateEmployeeDto): Promise<EmployeeEntity | null> {
    const existing = await this.getEmployeeByIdOrCode(merchantId, idOrCode);
    if (!existing) return null;
    if (dto.firstName !== undefined) existing.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) existing.lastName = dto.lastName.trim();
    if (dto.email !== undefined) existing.email = dto.email?.trim().toLowerCase() || null;
    if (dto.phone !== undefined) existing.phone = dto.phone?.trim() || null;
    if (dto.dateOfBirth !== undefined) existing.dateOfBirth = dto.dateOfBirth || null;
    if (dto.gender !== undefined) existing.gender = dto.gender?.trim() || null;
    if (dto.addressLine1 !== undefined) existing.addressLine1 = dto.addressLine1.trim();
    if (dto.addressLine2 !== undefined) existing.addressLine2 = dto.addressLine2.trim();
    if (dto.city !== undefined) existing.city = dto.city.trim();
    if (dto.state !== undefined) existing.state = dto.state.trim();
    if (dto.postalCode !== undefined) existing.postalCode = dto.postalCode.trim();
    if (dto.country !== undefined) existing.country = dto.country.trim();
    if (dto.username !== undefined) existing.username = dto.username.trim().toLowerCase();
    if (dto.loginPin !== undefined) existing.loginPinHash = dto.loginPin ? this.hashEmployeePin(dto.loginPin) : null;
    if (dto.temporaryPassword !== undefined) existing.passwordHash = null;
    if (dto.sendCredentials !== undefined) existing.sendCredentials = dto.sendCredentials;
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedAt = new Date();
    return this.dataSource.transaction(async manager => {
      const saved = await manager.getRepository(EmployeeEntity).save(existing);
      if (saved.userId) {
        const updates: string[] = ['"firstName"=$2', '"lastName"=$3', '"phoneNumber"=$4', 'status=$5', '"updatedAt"=clock_timestamp()'];
        const values: unknown[] = [saved.userId, saved.firstName, saved.lastName, saved.phone || '', saved.status === EmployeeStatus.ACTIVE ? 'ACTIVE' : 'DISABLED'];
        if (dto.email !== undefined) { values.push(saved.email); updates.push(`email=$${values.length}`); }
        if (dto.username !== undefined) { values.push(dto.username.trim().toLowerCase()); updates.push(`username=$${values.length}`); }
        if (dto.temporaryPassword !== undefined) { values.push(this.hashUserPassword(dto.temporaryPassword)); updates.push(`"passwordHash"=$${values.length}`); }
        await manager.query(`UPDATE public.users SET ${updates.join(',')} WHERE id=$1`, values);
      }
      if (dto.storeAssignments) {
        await this.syncEmployeeAssignmentsWithManager(manager, saved.merchantId, saved.id, dto.storeAssignments);
      }
      return saved;
    });
  }

  async deleteEmployee(merchantId: string | undefined, idOrCode: string): Promise<boolean> {
    const existing = await this.getEmployeeByIdOrCode(merchantId, idOrCode);
    if (!existing) return false;
    existing.status = EmployeeStatus.INACTIVE;
    existing.updatedAt = new Date();
    await this.employeeRepo.save(existing);
    if (existing.userId) await this.dataSource.query('UPDATE public.users SET status=\'DISABLED\',"updatedAt"=clock_timestamp() WHERE id=$1', [existing.userId]);
    return true;
  }

  async updateEmployeeProfileImage(merchantId: string | undefined, idOrCode: string, profileImageUrl: string | null): Promise<EmployeeEntity | null> {
    const employee = await this.getEmployeeByIdOrCode(merchantId, idOrCode);
    if (!employee) return null;
    employee.profileImageUrl = profileImageUrl;
    employee.updatedAt = new Date();
    return this.employeeRepo.save(employee);
  }

  async listRolesAvailableForStore(storeId: string, merchantIdentifier?: string): Promise<Record<string, unknown>[]> {
    const stores = await this.dataSource.query(
      `SELECT s.legacy_store_id AS id,s.id AS "storeUuid",s.merchant_uuid AS "merchantUuid",
              COALESCE(to_jsonb(s)->>'merchant_id',to_jsonb(s)->>'merchantId') AS "merchantId",
              COALESCE(to_jsonb(s)->>'store_type_id',to_jsonb(s)->>'storeType') AS "storeTypeId"
       FROM public.stores s
       WHERE (s.legacy_store_id::text=$1 OR s.id::text=$1) LIMIT 1`,
      [storeId],
    );
    if (!stores[0]) throw new NotFoundException('Store not found');
    if (merchantIdentifier && ![stores[0].merchantId, stores[0].merchantUuid].includes(merchantIdentifier)) {
      throw new NotFoundException('Store not found for merchant');
    }
    const merchantId = stores[0].merchantId;
    const storeTypeValue = stores[0].storeTypeId;
    if (!storeTypeValue) throw new BadRequestException('Store does not have a store type');
    const storeTypes = await this.dataSource.query(
      `SELECT st.id FROM public.store_types st
       WHERE st.id::text=$1 OR lower(COALESCE(to_jsonb(st)->>'store_type_code',to_jsonb(st)->>'storeTypeCode'))=lower($1)
       LIMIT 1`,
      [String(storeTypeValue)],
    );
    if (!storeTypes[0]) throw new BadRequestException(`Store type '${storeTypeValue}' is not configured`);
    const storeTypeId = String(storeTypes[0].id);
    return this.dataSource.query(
      `SELECT rt.id AS "roleTemplateId",rt.role_code AS "roleCode",rt.name,rt.description,
              r.id AS "roleId",r.status AS "roleStatus",(r.id IS NOT NULL AND r.status='ACTIVE') AS assignable,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'permissionId',rp.permission_id,'permissionKey',p.permission_key,
                'name',p.name,'allowed',rp.allowed) ORDER BY p.name)
                FROM public.role_permissions rp
                JOIN public.permissions p ON p.id=rp.permission_id
                WHERE rp.role_id=r.id AND rp.merchant_id=$3::uuid
                  AND rp.store_id=$4::uuid),'[]'::jsonb) AS permissions
       FROM public.store_type_role_templates mapping
       JOIN public.role_templates rt ON rt.id=mapping.role_template_id AND rt.status='ACTIVE'
       LEFT JOIN public.roles r ON r.merchant_id::text=$1 AND r.source_role_template_id=rt.id
       WHERE mapping.store_type_id::text=$2 AND mapping.default_enabled=true
       ORDER BY rt.name`,
      [merchantId, storeTypeId, stores[0].merchantUuid, stores[0].storeUuid],
    );
  }

  private async nextEmployeeCode(manager: EntityManager, merchantId: string): Promise<string> {
    const rows = await manager.query(
      `SELECT employee_code FROM public.employees
       WHERE merchant_id=$1::uuid AND employee_code ~ '^EMP-[0-9]+$'
       ORDER BY length(employee_code) DESC, employee_code DESC LIMIT 1`,
      [merchantId],
    );
    const last = Number(String(rows[0]?.employee_code || 'EMP-1000').replace(/\D/g, '')) || 1000;
    return `EMP-${last + 1}`;
  }

  private hashEmployeePin(value: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(value, salt, 32).toString('hex')}`;
  }

  private hashUserPassword(value: string): string {
    const salt = crypto.randomBytes(16);
    return `${salt.toString('base64url')}:${crypto.scryptSync(value, salt, 64).toString('base64url')}`;
  }

  private async syncEmployeeAssignmentsWithManager(
    manager: EntityManager,
    merchantId: string,
    employeeId: string,
    assignments?: Array<{ store: string; roles?: string[]; loginPin?: string }>,
  ): Promise<void> {
      const merchants = await manager.query('SELECT m.id,m."merchantId" AS "merchantCode" FROM public.merchants m LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode" WHERE m."merchantId"=$1 OR m."merchantCode"=$1 OR m.id::text=$1 ORDER BY v.version ASC NULLS LAST,m."createdAt" LIMIT 1', [merchantId]);
      if (!merchants[0]) throw new NotFoundException('Merchant not found');
      const merchantUuid = merchants[0].id;
      const merchantCode = merchants[0].merchantCode;
      const keepStoreIds: string[] = [];
      if (!assignments) return;
      for (const [index, assignment] of assignments.entries()) {
        const stores = await manager.query(
          `SELECT s.id,COALESCE(to_jsonb(s)->>'store_type_id',to_jsonb(s)->>'storeType') AS "storeType"
           FROM public.stores s
           WHERE COALESCE(to_jsonb(s)->>'merchant_id',to_jsonb(s)->>'merchantId')=$1
             AND (s.legacy_store_id::text=$2 OR s.id::text=$2
               OR COALESCE(to_jsonb(s)->>'store_code',to_jsonb(s)->>'storeCode')=$2
               OR lower(COALESCE(to_jsonb(s)->>'name',to_jsonb(s)->>'storeName'))=lower($2))
           LIMIT 1`,
          [merchantCode, assignment.store],
        );
        if (!stores[0]) throw new BadRequestException(`Store '${assignment.store}' does not belong to this merchant`);
        keepStoreIds.push(stores[0].id);
        const existing = await manager.query(
          `SELECT id,login_pin_hash AS "loginPinHash" FROM public.employee_stores
           WHERE merchant_id=$1::uuid AND employee_id=$2 AND store_id=$3::uuid LIMIT 1`,
          [merchantUuid, employeeId, stores[0].id],
        );
        const pinHash = assignment.loginPin ? this.hashEmployeePin(assignment.loginPin) : existing[0]?.loginPinHash || null;
        const upserted = existing[0]
          ? (await manager.query(
            `UPDATE public.employee_stores SET is_primary=$2, login_pin_hash=$3, updated_at=now()
             WHERE id=$1 RETURNING id`,
            [existing[0].id, index === 0, pinHash],
          ))
          : (await manager.query(
            `INSERT INTO public.employee_stores(merchant_id,employee_id,store_id,is_primary,login_pin_hash)
             VALUES($1,$2,$3,$4,$5) RETURNING id`,
            [merchantUuid, employeeId, stores[0].id, index === 0, pinHash],
          ));
        await manager.query('DELETE FROM public.employee_store_roles WHERE merchant_id=$1::uuid AND employee_store_id=$2', [merchantUuid, upserted[0].id]);
        for (const role of assignment.roles || []) {
          const existingRole = await manager.query(
            `SELECT id FROM public.roles WHERE id=$1::uuid AND merchant_id=$2 AND status='ACTIVE' LIMIT 1`,
            [role, merchantCode],
          );
          if (!existingRole.length) {
            throw new BadRequestException(`Role '${role}' does not exist as an active role for this merchant`);
          }
          const roles = await manager.query(
            `SELECT r.id FROM public.roles r
             JOIN public.store_type_role_templates mapping ON mapping.role_template_id=r.source_role_template_id AND mapping.default_enabled=true
             JOIN public.store_types st ON st.id=mapping.store_type_id
             WHERE r.merchant_id=$1 AND r.id=$2::uuid AND r.status='ACTIVE'
               AND (st.id::text=$3 OR lower(COALESCE(to_jsonb(st)->>'store_type_code',to_jsonb(st)->>'storeTypeCode'))=lower($3)) LIMIT 1`,
            [merchantCode, role, String(stores[0].storeType)],
          );
          if (!roles[0]) throw new BadRequestException(`Role '${role}' is not available for store '${assignment.store}' and its store type`);
          await manager.query(`INSERT INTO public.employee_store_roles(merchant_id,store_id,employee_store_id,role_id) VALUES($1,$2,$3,$4)`,
            [merchantUuid, stores[0].id, upserted[0].id, roles[0].id]);
        }
      }
      if (keepStoreIds.length) {
        await manager.query(
          `DELETE FROM public.employee_store_roles WHERE merchant_id=$1::uuid AND employee_store_id IN
           (SELECT id FROM public.employee_stores WHERE merchant_id=$1::uuid AND employee_id=$2 AND store_id <> ALL($3::uuid[]))`,
          [merchantUuid, employeeId, keepStoreIds],
        );
        await manager.query(
          `DELETE FROM public.employee_stores WHERE merchant_id=$1::uuid AND employee_id=$2 AND store_id <> ALL($3::uuid[])`,
          [merchantUuid, employeeId, keepStoreIds],
        );
      }
  }

}
