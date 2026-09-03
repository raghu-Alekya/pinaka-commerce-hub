import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import {
  PosConfigEntity,
  FastkeyItem,
  DiscountConfig,
  PaymentTender,
  TaxSettings,
} from './pos-config.entity';

@Injectable()
export class PosConfigRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private configRepo?: Repository<PosConfigEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  // In-Memory Fallback
  private memoryConfigs = new Map<string, PosConfigEntity>();

  async onModuleInit() {
    // 1. PostgreSQL Connection
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_commerce_hub',
        entities: [PosConfigEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.configRepo = this.dataSource.getRepository(PosConfigEntity);
      this.isDbConnected = true;
      console.log('🐘 [PCH POS Config DB] Connected to PostgreSQL: pinaka_commerce_hub');
      await this.seedDefaultConfig('STR-5001', 'MCH-1001', 'RETAIL');
    } catch (err: any) {
      console.log(`⚠️ [PCH POS Config DB] Offline (${err.message}). Using In-Memory Mode.`);
      this.isDbConnected = false;
      this.seedDefaultInMemory('STR-5001', 'MCH-1001', 'RETAIL');
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
      console.log('⚡ [PCH POS Config Redis] Connected for <1ms POS terminal startup caching');
    } catch (err: any) {
      console.log(`⚠️ [PCH POS Config Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  /**
   * Seed default configuration for store
   */
  private async seedDefaultConfig(storeId: string, merchantId: string, businessType: string) {
    if (!this.configRepo) return;
    const existing = await this.configRepo.findOne({ where: { storeId } });
    if (!existing) {
      const config = this.buildDefaultConfig(storeId, merchantId, businessType);
      const entity = this.configRepo.create(config);
      await this.configRepo.save(entity);
      await this.cacheConfig(config);
      console.log(`✅ [POS Seed] Created default POS config for Store ${storeId}`);
    }
  }

  private seedDefaultInMemory(storeId: string, merchantId: string, businessType: string) {
    if (!this.memoryConfigs.has(storeId)) {
      const config = this.buildDefaultConfig(storeId, merchantId, businessType);
      this.memoryConfigs.set(storeId, config);
    }
  }

  private buildDefaultConfig(storeId: string, merchantId: string, businessType: string): PosConfigEntity {
    const fastkeys: FastkeyItem[] = [
      { id: 'FK-1', name: 'Organic Milk 1L', price: 4.99, colorHex: '#4F46E5', category: 'Dairy', sku: 'SKU-MILK-01', sortOrder: 1 },
      { id: 'FK-2', name: 'Fresh Avocado (Ea)', price: 1.99, colorHex: '#10B981', category: 'Produce', sku: 'SKU-AVO-01', sortOrder: 2 },
      { id: 'FK-3', name: 'Whole Wheat Bread', price: 3.49, colorHex: '#F59E0B', category: 'Bakery', sku: 'SKU-BRD-01', sortOrder: 3 },
      { id: 'FK-4', name: 'Espresso Coffee (L)', price: 4.50, colorHex: '#8B5CF6', category: 'Beverages', sku: 'SKU-COF-01', sortOrder: 4 },
      { id: 'FK-5', name: 'Sparkling Mineral Water', price: 2.25, colorHex: '#06B6D4', category: 'Beverages', sku: 'SKU-WTR-01', sortOrder: 5 },
    ];

    const discounts: DiscountConfig[] = [
      { id: 'DISC-10', code: 'SENIOR10', name: 'Senior Citizen Discount (10%)', type: 'PERCENTAGE', value: 10, requiresManagerPin: false, active: true },
      { id: 'DISC-20', code: 'EMP20', name: 'Employee Discount (20%)', type: 'PERCENTAGE', value: 20, requiresManagerPin: true, active: true },
      { id: 'DISC-5', code: 'PROMO5', name: 'Flat $5 Promo Discount', type: 'FIXED_AMOUNT', value: 5, requiresManagerPin: false, active: true },
    ];

    const tenders: PaymentTender[] = [
      { id: 'TND-CASH', code: 'CASH', name: 'Cash Payment', enabled: true, allowSplit: true, openCashDrawer: true },
      { id: 'TND-CARD', code: 'CARD', name: 'Credit / Debit Card', enabled: true, allowSplit: true, openCashDrawer: false },
      { id: 'TND-SPLIT', code: 'SPLIT', name: 'Split Payment (Cash + Card)', enabled: true, allowSplit: true, openCashDrawer: true },
      { id: 'TND-UPI', code: 'UPI', name: 'UPI / QR Mobile Pay', enabled: true, allowSplit: false, openCashDrawer: false },
    ];

    const taxSettings: TaxSettings = {
      taxName: 'Sales Tax',
      taxRate: 8.25,
      taxInclusive: false,
      roundingRule: 'NEAREST_FIVE_CENTS',
      receiptHeader: 'Pinaka Commerce Hub — Fresh Mart Store #5001\n123 Main St, Austin TX',
      receiptFooter: 'Thank you for shopping with us!\nVisit us online at pinaka.io',
    };

    return {
      storeId,
      merchantId,
      businessType,
      fastkeys,
      discounts,
      tenders,
      taxSettings,
      managerPin: '1234',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Fetch complete POS Store Configuration
   */
  async getStoreConfig(storeId: string): Promise<PosConfigEntity> {
    // 1. Try Redis cache for <1ms speed
    const cached = await this.getCachedConfig(storeId);
    if (cached) return cached;

    // 2. Try PostgreSQL DB
    if (this.isDbConnected && this.configRepo) {
      let config = await this.configRepo.findOne({ where: { storeId } });
      if (!config) {
        config = this.buildDefaultConfig(storeId, 'MCH-1001', 'RETAIL');
        const entity = this.configRepo.create(config);
        config = await this.configRepo.save(entity);
      }
      await this.cacheConfig(config);
      return config;
    }

    // 3. In-memory fallback
    if (!this.memoryConfigs.has(storeId)) {
      this.seedDefaultInMemory(storeId, 'MCH-1001', 'RETAIL');
    }
    return this.memoryConfigs.get(storeId)!;
  }

  /**
   * Update Fastkeys Grid
   */
  async updateFastkeys(storeId: string, fastkeys: FastkeyItem[]): Promise<PosConfigEntity> {
    const config = await this.getStoreConfig(storeId);
    config.fastkeys = fastkeys;
    config.version += 1;
    config.updatedAt = new Date();

    return await this.saveConfig(config);
  }

  /**
   * Update Discounts Configuration
   */
  async updateDiscounts(storeId: string, discounts: DiscountConfig[]): Promise<PosConfigEntity> {
    const config = await this.getStoreConfig(storeId);
    config.discounts = discounts;
    config.version += 1;
    config.updatedAt = new Date();

    return await this.saveConfig(config);
  }

  /**
   * Update Payment Tenders
   */
  async updateTenders(storeId: string, tenders: PaymentTender[]): Promise<PosConfigEntity> {
    const config = await this.getStoreConfig(storeId);
    config.tenders = tenders;
    config.version += 1;
    config.updatedAt = new Date();

    return await this.saveConfig(config);
  }

  /**
   * Verify Manager PIN for Void / Override
   */
  async verifyManagerPin(storeId: string, pin: string): Promise<{ valid: boolean; message: string }> {
    const config = await this.getStoreConfig(storeId);
    if (config.managerPin === pin.trim()) {
      return { valid: true, message: 'Manager PIN verified successfully' };
    }
    return { valid: false, message: 'Invalid Manager PIN authorization code' };
  }

  private async saveConfig(config: PosConfigEntity): Promise<PosConfigEntity> {
    if (this.isDbConnected && this.configRepo) {
      const entity = this.configRepo.create(config);
      const saved = await this.configRepo.save(entity);
      await this.cacheConfig(saved);
      return saved;
    } else {
      this.memoryConfigs.set(config.storeId, config);
      return config;
    }
  }

  private async cacheConfig(config: PosConfigEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`pos:config:${config.storeId}`, JSON.stringify(config), 'EX', 86400);
      } catch {}
    }
  }

  private async getCachedConfig(storeId: string): Promise<PosConfigEntity | null> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const data = await this.redisClient.get(`pos:config:${storeId}`);
        if (data) return JSON.parse(data);
      } catch {}
    }
    return null;
  }
}
