import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { MerchantEntity, BusinessType, RetailSubCategory, MerchantStatus, KycStatus } from './entities/merchant.entity';
import { StoreEntity, StoreStatus, OperationalStatus, StoreWebsiteConnectorConfig } from './entities/store.entity';
import { SubscriptionEntity, PlanCode, SubscriptionStatus } from './entities/subscription.entity';
import { OnboardingAuditEntity } from './entities/onboarding-audit.entity';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity';

@Injectable()
export class MerchantRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private merchantRepo?: Repository<MerchantEntity>;
  private storeRepo?: Repository<StoreEntity>;
  private subRepo?: Repository<SubscriptionEntity>;
  private planRepo?: Repository<SubscriptionPlanEntity>;
  private plansStore: SubscriptionPlanEntity[] = [];
  private auditRepo?: Repository<OnboardingAuditEntity>;
  private redisClient?: Redis;
  private isDbConnected = true;
  private isRedisConnected = false;
  private databaseError?: string;

  get databaseStatus(): string {
    return this.isDbConnected ? 'connected' : `unavailable: ${this.databaseError || 'unknown error'}`;
  }

  // In-Memory Fallback Stores
  private merchantsStore: MerchantEntity[] = [];
  private storesStore: StoreEntity[] = [];
  private subscriptionsStore: SubscriptionEntity[] = [];
  private auditLogsStore: OnboardingAuditEntity[] = [];

  async onModuleInit() {
    // 1. PostgreSQL connection using the configured application database.
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL || undefined,
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [MerchantEntity, StoreEntity, SubscriptionEntity, OnboardingAuditEntity, SubscriptionPlanEntity],
        synchronize: false,
      });

      await this.dataSource.initialize();
      this.merchantRepo = this.dataSource.getRepository(MerchantEntity);
      this.storeRepo = this.dataSource.getRepository(StoreEntity);
      this.subRepo = this.dataSource.getRepository(SubscriptionEntity);
      this.planRepo = this.dataSource.getRepository(SubscriptionPlanEntity);
      this.auditRepo = this.dataSource.getRepository(OnboardingAuditEntity);
      this.isDbConnected = true;
      console.log('🐘 [PCH Merchant DB] Connected to PostgreSQL database');
      await this.seedDefaultData();
    } catch (err: any) {
      this.databaseError = err.message;
      this.isDbConnected = false;
      const requireDatabase = process.env.REQUIRE_DATABASE === 'true' || process.env.NODE_ENV === 'production';
      if (requireDatabase) {
        throw new Error(`Merchant service cannot start because PostgreSQL is unavailable: ${err.message}`);
      }
      console.log(`⚠️ [PCH Merchant DB] Offline (${err.message}). Using In-Memory Mode because REQUIRE_DATABASE is not enabled.`);
      this.seedDefaultInMemory();
    }

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
      console.log('⚡ [PCH Merchant Redis] Connected to Redis for <1ms PIN & Entitlement caching');
    } catch (err: any) {
      console.log(`⚠️ [PCH Merchant Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
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
      console.log('✅ [PCH Seed] Seeded Demo Retail Merchant MCH-1001 & Store STR-5001 (PIN: 849201)');
    }
  }

  private seedDefaultInMemory() {
    if (this.merchantsStore.length === 0) {
      this.merchantsStore.push({
        id: 'MCH-1001',
        businessName: 'Fresh Mart Organics LLC',
        businessType: BusinessType.RETAIL,
        retailSubCategory: RetailSubCategory.GROCERY,
        ownerName: 'Alex Johnson',
        email: 'alex@freshmart.com',
        phone: '+1 (555) 234-5678',
        taxId: '12-3456789',
        kycStatus: KycStatus.VERIFIED,
        kycDocuments: [],
        billingContact: true,
        status: MerchantStatus.ACTIVE,
        onboardingStep: 'COMPLETED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.storesStore.push({
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
        autoAcceptOrders: true,
        status: StoreStatus.ACTIVE,
        operationalStatus: OperationalStatus.OPEN,
        channels: [{ platform: 'POS', externalStoreId: 'POS-01', apiKey: 'key_pos_1', enabled: true }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.subscriptionsStore.push({
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
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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

    if (this.isDbConnected && this.auditRepo) {
      try {
        const entity = this.auditRepo.create(entry);
        await this.auditRepo.save(entity);
      } catch {}
    } else {
      this.auditLogsStore.unshift(entry);
    }
  }

  async createMerchant(data: Partial<MerchantEntity>): Promise<MerchantEntity> {
    const id = data.id || `MCH-${Math.floor(1000 + Math.random() * 9000)}`;
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

    if (this.isDbConnected && this.merchantRepo) {
      const entity = this.merchantRepo.create(merchant);
      const saved = await this.merchantRepo.save(entity);
      await this.recordAuditLog('MERCHANT_CREATED', saved.id, undefined, saved.email, { businessName: saved.businessName });
      return saved;
    } else {
      this.merchantsStore.unshift(merchant);
      await this.recordAuditLog('MERCHANT_CREATED', merchant.id, undefined, merchant.email, { businessName: merchant.businessName });
      return merchant;
    }
  }

  async getAllMerchants(): Promise<MerchantEntity[]> {
    if (this.isDbConnected && this.merchantRepo) {
      return await this.merchantRepo.find({ order: { createdAt: 'DESC' } });
    }
    return this.merchantsStore;
  }

  async updateMerchant(id: string, data: Partial<MerchantEntity>): Promise<MerchantEntity | null> {
    if (this.isDbConnected && this.merchantRepo) {
      const merchant = await this.merchantRepo.findOne({ where: { id } });
      if (!merchant) return null;
      Object.assign(merchant, data, { id, updatedAt: new Date() });
      const saved = await this.merchantRepo.save(merchant);
      await this.recordAuditLog('MERCHANT_UPDATED', id, undefined, saved.email, { businessName: saved.businessName });
      return saved;
    }

    const index = this.merchantsStore.findIndex((merchant) => merchant.id === id);
    if (index === -1) return null;
    this.merchantsStore[index] = { ...this.merchantsStore[index], ...data, id, updatedAt: new Date() };
    await this.recordAuditLog('MERCHANT_UPDATED', id, undefined, this.merchantsStore[index].email, { businessName: this.merchantsStore[index].businessName });
    return this.merchantsStore[index];
  }

  async getMerchantById(id: string): Promise<{ merchant: MerchantEntity | null; stores: StoreEntity[]; subscription: SubscriptionEntity | null }> {
    let merchant: MerchantEntity | null = null;
    let stores: StoreEntity[] = [];
    let subscription: SubscriptionEntity | null = null;

    if (this.isDbConnected && this.merchantRepo && this.storeRepo && this.subRepo) {
      merchant = await this.merchantRepo.findOne({ where: { id } });
      if (merchant) {
        stores = await this.storeRepo.find({ where: { merchantId: id } });
        subscription = await this.subRepo.findOne({ where: { merchantId: id } });
      }
    } else {
      merchant = this.merchantsStore.find(m => m.id === id) || null;
      if (merchant) {
        stores = this.storesStore.filter(s => s.merchantId === id);
        subscription = this.subscriptionsStore.find(sub => sub.merchantId === id) || null;
      }
    }

    return { merchant, stores, subscription };
  }

  private buildStore(merchantId: string, data: Partial<StoreEntity>): StoreEntity {
    const id = data.id || `STR-${Math.floor(5000 + Math.random() * 5000)}`;
    const activationPin = data.activationPin || Math.floor(100000 + Math.random() * 900000).toString();
    const storeCode = data.storeCode || `STR-${Date.now().toString().slice(-4)}`;

    const store: StoreEntity = {
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

    return store;
  }

  async createStore(merchantId: string, data: Partial<StoreEntity>): Promise<StoreEntity> {
    const store = this.buildStore(merchantId, data);
    const { id, storeCode, activationPin } = store;
    if (this.isDbConnected && this.storeRepo) {
      const entity = this.storeRepo.create(store);
      // Insert only: creating an existing ID must never overwrite another store.
      try {
        await this.storeRepo.insert(entity);
      } catch (error: any) {
        if (error.code === '23505' || error.driverError?.code === '23505') {
          throw new ConflictException('Store ID or store code already exists. Choose a different Store ID.');
        }
        throw error;
      }
      const saved = entity;
      await this.cacheStorePin(activationPin, saved);
      await this.recordAuditLog('STORE_CREATED', merchantId, saved.id, 'merchant', { storeName: saved.storeName, pin: activationPin });
      return saved;
    } else {
      if (this.storesStore.some(s => s.id === id || s.storeCode === storeCode)) {
        throw new ConflictException('Store ID or store code already exists. Choose a different Store ID.');
      }
      this.storesStore.unshift(store);
      await this.cacheStorePin(activationPin, store);
      await this.recordAuditLog('STORE_CREATED', merchantId, store.id, 'merchant', { storeName: store.storeName, pin: activationPin });
      return store;
    }
  }

<<<<<<< HEAD
  async createStoresBatch(merchantId: string, data: Partial<StoreEntity>[]): Promise<StoreEntity[]> {
    const stores = data.map(item => this.buildStore(merchantId, item));
    if (new Set(stores.map(s => s.id)).size !== stores.length ||
        new Set(stores.map(s => s.storeCode)).size !== stores.length) {
      throw new ConflictException('Each store must have a unique Store ID.');
    }
    if (this.isDbConnected && this.storeRepo) {
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
    } else {
      if (stores.some(s => this.storesStore.some(existing => existing.id === s.id || existing.storeCode === s.storeCode))) {
        throw new ConflictException('A Store ID already exists. No stores were added.');
      }
      this.storesStore.unshift(...stores);
    }
    for (const store of stores) {
      await this.cacheStorePin(store.activationPin, store);
      await this.recordAuditLog('STORE_CREATED', merchantId, store.id, 'merchant', { storeName: store.storeName });
    }
    return stores;
=======
  async getStoreById(id: string): Promise<StoreEntity | null> {
    if (this.isDbConnected && this.storeRepo) return this.storeRepo.findOne({ where: { id } });
    const store = this.storesStore.find(s => s.id === id);
    if (!store) return null;
    const { websiteConnector, ...details } = store;
    return details;
  }

  async updateStore(id: string, data: Partial<StoreEntity>): Promise<StoreEntity | null> {
    const existing = await this.getStoreById(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, id, merchantId: existing.merchantId, updatedAt: new Date() };
    if (this.isDbConnected && this.storeRepo) {
      await this.storeRepo.update(id, data);
    } else {
      const index = this.storesStore.findIndex(s => s.id === id);
      this.storesStore[index] = { ...this.storesStore[index], ...updated };
    }
    await this.cacheStorePin(updated.activationPin, updated);
    await this.recordAuditLog('STORE_UPDATED', updated.merchantId, id, 'merchant', { storeName: updated.storeName });
    return updated;
>>>>>>> 3ed0314e7bf901ae6aba82319f882ec67af15b2a
  }

  async createOrUpdateStore(merchantId: string, data: Partial<StoreEntity>): Promise<StoreEntity> {
    if (data.id && this.isDbConnected && this.storeRepo) {
      const existing = await this.storeRepo.findOne({ where: { id: data.id } });
      if (existing) {
        if (existing.merchantId !== merchantId) throw new Error(`Store ID '${data.id}' belongs to another merchant`);
        Object.assign(existing, data, { merchantId, updatedAt: new Date() });
        const saved = await this.storeRepo.save(existing);
        await this.recordAuditLog('STORE_UPDATED', merchantId, saved.id, 'merchant', { storeName: saved.storeName });
        return saved;
      }
    }
    if (data.id && !this.isDbConnected) {
      const index = this.storesStore.findIndex((store) => store.id === data.id);
      if (index >= 0) {
        if (this.storesStore[index].merchantId !== merchantId) throw new Error(`Store ID '${data.id}' belongs to another merchant`);
        this.storesStore[index] = { ...this.storesStore[index], ...data, merchantId, updatedAt: new Date() };
        await this.recordAuditLog('STORE_UPDATED', merchantId, data.id, 'merchant', { storeName: this.storesStore[index].storeName });
        return this.storesStore[index];
      }
    }
    return this.createStore(merchantId, data);
  }

  async getStoreById(id: string): Promise<StoreEntity | null> {
    if (this.isDbConnected && this.storeRepo) return this.storeRepo.findOneBy({ id });
    const store = this.storesStore.find(s => s.id === id);
    if (!store) return null;
    const { websiteConnector, ...publicStore } = store;
    return publicStore;
  }

  async listStores(merchantId?: string): Promise<StoreEntity[]> {
    if (this.isDbConnected && this.storeRepo) {
      return this.storeRepo.find({ where: merchantId ? { merchantId } : {}, order: { createdAt: 'DESC' } });
    }
    return this.storesStore.filter(s => !merchantId || s.merchantId === merchantId);
  }

  async updateStore(id: string, fields: Partial<StoreEntity>): Promise<StoreEntity | null> {
    const store = await this.getStoreById(id);
    if (!store) return null;
    const updated = { ...store, ...fields, id, merchantId: store.merchantId, updatedAt: new Date() };
    if (this.isDbConnected && this.storeRepo) {
      const result = await this.storeRepo.update(id, { ...fields, updatedAt: updated.updatedAt });
      if (!result.affected) return null;
    } else {
      const index = this.storesStore.findIndex(s => s.id === id);
      this.storesStore[index] = { ...this.storesStore[index], ...updated };
    }
    await this.cacheStorePin(updated.activationPin, updated);
    await this.recordAuditLog('STORE_UPDATED', store.merchantId, id, 'merchant', { storeName: updated.storeName });
    return updated;
  }

  async saveWebsiteConnector(
    storeId: string,
    connector: StoreWebsiteConnectorConfig,
  ): Promise<StoreEntity | null> {
    if (this.isDbConnected && this.storeRepo) {
      const store = await this.storeRepo.findOne({ where: { id: storeId } });
      if (!store) return null;
      store.websiteConnector = connector;
      store.updatedAt = new Date();
      return this.storeRepo.save(store);
    }
    const store = this.storesStore.find((candidate) => candidate.id === storeId);
    if (!store) return null;
    store.websiteConnector = connector;
    store.updatedAt = new Date();
    return store;
  }

  async getWebsiteConnector(storeId: string): Promise<StoreWebsiteConnectorConfig | null> {
    if (this.isDbConnected && this.storeRepo) {
      const store = await this.storeRepo
        .createQueryBuilder('store')
        .addSelect('store.websiteConnector')
        .where('store.id = :storeId', { storeId })
        .getOne();
      return store?.websiteConnector ?? null;
    }
    return this.storesStore.find((candidate) => candidate.id === storeId)?.websiteConnector ?? null;
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

    let store: StoreEntity | null = null;
    if (this.isDbConnected && this.storeRepo) {
      store = await this.storeRepo.findOne({ where: { activationPin: pin } });
    } else {
      store = this.storesStore.find(s => s.activationPin === pin) || null;
    }

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
    const planCode = data.planCode || PlanCode.PRO;
    let defaultEntitlements = ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY'];
    let maxStores = 3;
    let price = 99.00;

    if (planCode === PlanCode.STARTER) {
      defaultEntitlements = ['POS', 'BASIC_INVENTORY', 'RECEIPT_PRINTER'];
      maxStores = 1;
      price = 49.00;
    } else if (planCode === PlanCode.ENTERPRISE) {
      defaultEntitlements = ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY', 'CUSTOM_ERP'];
      maxStores = 999;
      price = 199.00;
    }

    const sub: SubscriptionEntity = {
      id: data.id || `SUB-${Math.floor(9000 + Math.random() * 1000)}`,
      merchantId,
      planCode,
      planName: data.planName || `${planCode} Plan`,
      maxStoresAllowed: data.maxStoresAllowed || maxStores,
      entitlements: data.entitlements || defaultEntitlements,
      billingCycle: data.billingCycle || 'MONTHLY',
      price: data.price || price,
      trialDays: data.trialDays || 0,
      status: data.status || SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.isDbConnected && this.subRepo) {
      let entity = await this.subRepo.findOne({ where: { merchantId } });
      if (!entity) entity = this.subRepo.create(sub);
      else Object.assign(entity, sub);
      const saved = await this.subRepo.save(entity);
      await this.recordAuditLog('SUBSCRIPTION_UPDATED', merchantId, undefined, 'system', { planCode: saved.planCode, entitlements: saved.entitlements });
      return saved;
    } else {
      const idx = this.subscriptionsStore.findIndex(s => s.merchantId === merchantId);
      if (idx >= 0) this.subscriptionsStore[idx] = sub;
      else this.subscriptionsStore.unshift(sub);
      await this.recordAuditLog('SUBSCRIPTION_UPDATED', merchantId, undefined, 'system', { planCode: sub.planCode, entitlements: sub.entitlements });
      return sub;
    }
  }

  async listSubscriptions(merchantId?: string): Promise<SubscriptionEntity[]> {
    if (this.isDbConnected && this.subRepo) return this.subRepo.find({ where: merchantId ? { merchantId } : {}, order: { createdAt: 'DESC' } });
    return this.subscriptionsStore.filter(s => !merchantId || s.merchantId === merchantId);
  }

  async getSubscription(id: string): Promise<SubscriptionEntity | null> {
    if (this.isDbConnected && this.subRepo) return this.subRepo.findOneBy({ id });
    return this.subscriptionsStore.find(s => s.id === id) || null;
  }

  async insertSubscription(subscription: SubscriptionEntity): Promise<SubscriptionEntity> {
    if (this.isDbConnected && this.subRepo) {
      try { await this.subRepo.insert(subscription); }
      catch (error: any) {
        if (error.code === '23505' || error.driverError?.code === '23505') throw new ConflictException('Subscription ID or merchant subscription already exists');
        throw error;
      }
    } else {
      if (this.subscriptionsStore.some(s => s.id === subscription.id || s.merchantId === subscription.merchantId)) {
        throw new ConflictException('Subscription ID or merchant subscription already exists');
      }
      this.subscriptionsStore.unshift(subscription);
    }
    await this.recordAuditLog('SUBSCRIPTION_CREATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: subscription.id });
    return subscription;
  }

  async updateSubscription(id: string, fields: Partial<SubscriptionEntity>): Promise<SubscriptionEntity | null> {
    const existing = await this.getSubscription(id);
    if (!existing) return null;
    const subscription = { ...existing, ...fields, id, merchantId: existing.merchantId, createdAt: existing.createdAt, updatedAt: new Date() };
    if (this.isDbConnected && this.subRepo) {
      if (!(await this.subRepo.update(id, { ...fields, updatedAt: subscription.updatedAt })).affected) return null;
    } else {
      this.subscriptionsStore[this.subscriptionsStore.findIndex(s => s.id === id)] = subscription;
    }
    await this.recordAuditLog('SUBSCRIPTION_UPDATED', subscription.merchantId, undefined, 'merchant', { subscriptionId: id });
    return subscription;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const existing = await this.getSubscription(id);
    if (!existing) return false;
    if (this.isDbConnected && this.subRepo) {
      if (!(await this.subRepo.delete(id)).affected) return false;
    } else {
      this.subscriptionsStore.splice(this.subscriptionsStore.findIndex(s => s.id === id), 1);
    }
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
    if (this.isDbConnected && this.planRepo) return this.planRepo.find({ order: { planCode: 'ASC' } });
    return [...this.plansStore].sort((a, b) => a.planCode.localeCompare(b.planCode));
  }

  async getSubscriptionPlan(planCode: string): Promise<SubscriptionPlanEntity | null> {
    if (this.isDbConnected && this.planRepo) return this.planRepo.findOneBy({ planCode });
    return this.plansStore.find(p => p.planCode === planCode) || null;
  }

  async createSubscriptionPlan(plan: SubscriptionPlanEntity): Promise<SubscriptionPlanEntity> {
    if (this.isDbConnected && this.planRepo) {
      try { await this.planRepo.insert(plan); }
      catch (error: any) {
        if (error.code === '23505' || error.driverError?.code === '23505') throw new ConflictException('Plan code already exists');
        throw error;
      }
    } else {
      if (this.plansStore.some(p => p.planCode === plan.planCode)) throw new ConflictException('Plan code already exists');
      this.plansStore.push(plan);
    }
    return plan;
  }

  async updateSubscriptionPlan(planCode: string, fields: Partial<SubscriptionPlanEntity>): Promise<SubscriptionPlanEntity | null> {
    const existing = await this.getSubscriptionPlan(planCode);
    if (!existing) return null;
    const plan = { ...existing, ...fields, planCode, createdAt: existing.createdAt, updatedAt: new Date() };
    if (this.isDbConnected && this.planRepo) {
      if (!(await this.planRepo.update({ planCode }, { ...fields, updatedAt: plan.updatedAt })).affected) return null;
    } else this.plansStore[this.plansStore.findIndex(p => p.planCode === planCode)] = plan;
    return plan;
  }

  async deleteSubscriptionPlan(planCode: string): Promise<boolean> {
    if (!(await this.getSubscriptionPlan(planCode))) return false;
    const inUse = this.isDbConnected && this.subRepo
      ? await this.subRepo.existsBy({ planCode: planCode as PlanCode })
      : this.subscriptionsStore.some(s => s.planCode === planCode);
    if (inUse) throw new ConflictException('Plan is assigned to a merchant. Set its status to INACTIVE instead.');
    if (this.isDbConnected && this.planRepo) return Boolean((await this.planRepo.delete({ planCode })).affected);
    this.plansStore.splice(this.plansStore.findIndex(p => p.planCode === planCode), 1);
    return true;
  }
}
