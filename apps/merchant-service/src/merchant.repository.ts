import * as crypto from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
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
  async masterData(table: 'store_types' | 'features' | 'role_templates' | 'plans', operation: 'list' | 'get' | 'create' | 'update' | 'delete', id?: string, fields: Record<string, unknown> = {}): Promise<any> {
    if (!this.isDbConnected || !this.dataSource?.isInitialized) throw new ServiceUnavailableException('Master data requires PostgreSQL');
    const columns: Record<string, string> = {
      name: 'name', description: 'description', status: 'status',
      ...({
        store_types: { storeTypeCode: 'store_type_code' },
        features: { featureKey: 'feature_key', category: 'category', featureType: 'feature_type' },
        role_templates: { roleCode: 'role_code', scopeType: 'scope_type' },
        plans: { planCode: 'plan_code', billingModel: 'billing_model', basePrice: 'base_price', currency: 'currency', billingCycle: 'billing_cycle' },
      }[table]),
    };
    const projection = ['id', ...Object.entries(columns).map(([key, column]) => `${column} AS "${key}"`), 'created_at AS "createdAt"', 'updated_at AS "updatedAt"'].join(', ');
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.some(([key]) => !columns[key])) throw new BadRequestException('Unknown master data field');
    if (operation === 'update' && !entries.length) throw new BadRequestException('Provide at least one field to update');
    let sql: string;
    let values: unknown[] = [];
    if (operation === 'list') sql = `SELECT ${projection} FROM public.${table} ORDER BY name, id`;
    else if (operation === 'get') { sql = `SELECT ${projection} FROM public.${table} WHERE id = $1`; values = [id]; }
    else if (operation === 'create') {
      values = [crypto.randomUUID(), ...entries.map(([, value]) => value)];
      sql = `INSERT INTO public.${table} (id, ${entries.map(([key]) => columns[key]).join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING ${projection}`;
    } else if (operation === 'update') {
      values = [id, ...entries.map(([, value]) => value)];
      sql = `UPDATE public.${table} SET ${entries.map(([key], index) => `${columns[key]} = $${index + 2}`).join(', ')}, updated_at = clock_timestamp() WHERE id = $1 RETURNING ${projection}`;
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
  private subRepo!: Repository<SubscriptionEntity>;
  private planRepo!: Repository<SubscriptionPlanEntity>;
  private auditRepo!: Repository<OnboardingAuditEntity>;
  private websiteConnectionRepo!: Repository<WebsiteConnectionEntity>;
  private categoryRepo!: Repository<CategoryEntity>;
  private productRepo!: Repository<ProductEntity>;
  private sessionRepo!: Repository<SessionEntity>;
  private redisClient?: Redis;
  private isDbConnected = true;
  private isRedisConnected = false;
  private databaseError?: string;

  get databaseStatus(): string {
    return this.isDbConnected ? 'connected' : `unavailable: ${this.databaseError || 'unknown error'}`;
  }

  async onModuleInit() {
    this.dataSource = await connectPostgres('PCH Merchant DB', [
      MerchantEntity,
      StoreEntity,
      SubscriptionEntity,
      OnboardingAuditEntity,
      SubscriptionPlanEntity,
      WebsiteConnectionEntity,
      CategoryEntity,
      ProductEntity,
      SessionEntity,
    ]);
    this.merchantRepo = this.dataSource.getRepository(MerchantEntity);
    this.storeRepo = this.dataSource.getRepository(StoreEntity);
    this.subRepo = this.dataSource.getRepository(SubscriptionEntity);
    this.planRepo = this.dataSource.getRepository(SubscriptionPlanEntity);
    this.auditRepo = this.dataSource.getRepository(OnboardingAuditEntity);
    this.websiteConnectionRepo = this.dataSource.getRepository(WebsiteConnectionEntity);
    this.categoryRepo = this.dataSource.getRepository(CategoryEntity);
    this.productRepo = this.dataSource.getRepository(ProductEntity);
    this.sessionRepo = this.dataSource.getRepository(SessionEntity);
    this.isDbConnected = true;
    await this.seedDefaultPlans();
    await this.seedDefaultData();

    // 2. Redis Connection
    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('âš¡ [PCH Merchant Redis] Connected to Redis for <1ms PIN & Entitlement caching');
    } catch (err: any) {
      console.log(`âš ï¸ [PCH Merchant Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultPlans() {
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
    if (!this.merchantRepo || !this.storeRepo || !this.subRepo) return;
    const existing = await this.merchantRepo.findOne({ where: { id: 'MCH-1001' } });
    if (!existing) {
      const mch1 = this.merchantRepo.create({
        id: 'MCH-1001',
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

  async createMerchant(data: Partial<MerchantEntity>): Promise<MerchantEntity> {
    const id = data.id || await this.allocateId('merchant');
    const merchant: MerchantEntity = {
      id,
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
    await this.recordAuditLog('MERCHANT_CREATED', saved.id, undefined, saved.email, { businessName: saved.businessName });
    return saved;
  }

  async getAllMerchants(): Promise<MerchantEntity[]> {
    return this.merchantRepo.find({ order: { createdAt: 'DESC' } });
  }

  async updateMerchant(id: string, data: Partial<MerchantEntity>): Promise<MerchantEntity | null> {
    const merchant = await this.merchantRepo.findOne({ where: { id } });
    if (!merchant) return null;
    Object.assign(merchant, data, { id, updatedAt: new Date() });
    const saved = await this.merchantRepo.save(merchant);
    await this.recordAuditLog('MERCHANT_UPDATED', id, undefined, saved.email, { businessName: saved.businessName });
    return saved;
  }

  async getMerchantById(id: string): Promise<{ merchant: MerchantEntity | null; stores: StoreEntity[]; subscription: SubscriptionEntity | null }> {
    const merchant = await this.merchantRepo.findOne({ where: { id } });
    if (!merchant) return { merchant: null, stores: [], subscription: null };
    const stores = await this.storeRepo.find({ where: { merchantId: id } });
    const subscription = await this.subRepo.findOne({ where: { merchantId: id } });
    return { merchant, stores, subscription };
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
    return this.storeRepo.findOneBy({ id });
  }

  async listStores(merchantId?: string): Promise<StoreEntity[]> {
    return this.storeRepo.find({ where: merchantId ? { merchantId } : {}, order: { createdAt: 'DESC' } });
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
    const planCode = data.planCode;
    const master = planCode ? await this.getSubscriptionPlan(planCode) : null;
    if (!master || master.status !== 'ACTIVE') throw new BadRequestException('Select an active subscription master plan');
    const previous = (await this.listSubscriptions(merchantId))[0];
    const sub: SubscriptionEntity = {
      id: previous?.id || data.id || `SUB-${crypto.randomUUID()}`,
      merchantId,
      planCode: master.planCode as PlanCode,
      planName: master.planName,
      maxStoresAllowed: master.maxStoresAllowed,
      entitlements: master.entitlements,
      billingCycle: master.billingCycle,
      price: Number(master.price),
      trialDays: master.trialDays,
      status: data.status || SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let entity = await this.subRepo.findOne({ where: { merchantId } });
    if (!entity) entity = this.subRepo.create(sub);
    else Object.assign(entity, sub);
    const saved = await this.subRepo.save(entity);
    await this.recordAuditLog('SUBSCRIPTION_UPDATED', merchantId, undefined, 'system', { planCode: saved.planCode, entitlements: saved.entitlements });
    return saved;
  }

  async listSubscriptions(merchantId?: string): Promise<SubscriptionEntity[]> {
    return this.subRepo.find({ where: merchantId ? { merchantId } : {}, order: { createdAt: 'DESC' } });
  }

  async getSubscription(id: string): Promise<SubscriptionEntity | null> {
    return this.subRepo.findOneBy({ id });
  }

  async insertSubscription(subscription: SubscriptionEntity): Promise<SubscriptionEntity> {
    try { await this.subRepo.insert(subscription); }
    catch (error: any) {
      if (error.code === '23505' || error.driverError?.code === '23505') throw new ConflictException('Subscription ID or merchant subscription already exists');
      throw error;
    }
    await this.recordAuditLog('SUBSCRIPTION_CREATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: subscription.id });
    return subscription;
  }

  async updateSubscription(id: string, fields: Partial<SubscriptionEntity>): Promise<SubscriptionEntity | null> {
    const existing = await this.getSubscription(id);
    if (!existing) return null;
    const subscription = { ...existing, ...fields, id, merchantId: existing.merchantId, createdAt: existing.createdAt, updatedAt: new Date() };
    if (!(await this.subRepo.update(id, { ...fields, updatedAt: subscription.updatedAt })).affected) return null;
    await this.recordAuditLog('SUBSCRIPTION_UPDATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: id });
    return subscription;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const existing = await this.getSubscription(id);
    if (!existing) return false;
    if (!(await this.subRepo.delete(id)).affected) return false;
    await this.recordAuditLog('SUBSCRIPTION_DELETED', existing.merchantId, undefined, 'merchant', { subscriptionId: id });
    return true;
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

}
