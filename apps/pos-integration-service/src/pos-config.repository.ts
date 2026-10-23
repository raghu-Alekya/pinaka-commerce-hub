import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import {
  PosConfigEntity,
  FastkeyItem,
  DiscountConfig,
  PaymentTender,
  TaxSettings,
} from './pos-config.entity';

@Injectable()
const STORE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PosConfigRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  // In-Memory Fallback
  private memoryConfigs = new Map<string, PosConfigEntity>();

  async onModuleInit() {
    try {
      this.dataSource = await connectPostgres('PCH POS Config DB', [], { synchronize: false });
      this.isDbConnected = true;
    } catch (err: any) {
      console.log(`⚠️ [PCH POS Config DB] Offline (${err.message}).`);
      this.isDbConnected = false;
    }

    // Redis Connection
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

    if (this.isDbConnected && this.dataSource && STORE_UUID.test(storeId)) {
      const stored = await this.readStored(storeId);
      if (stored) {
        await this.cacheConfig(stored);
        return stored;
      }
      const created = this.buildDefaultConfig(storeId, 'MCH-1001', 'RETAIL');
      return this.saveConfig(created);
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

  private async readStored(storeId: string): Promise<PosConfigEntity | null> {
    if (!this.dataSource) return null;
    try {
      const rows: Array<{ configuration_value: PosConfigEntity; created_at: Date; updated_at: Date }> = await this.dataSource.query(
        `SELECT configuration_value, created_at, updated_at
           FROM public.store_pos_configurations
          WHERE store_id = $1::uuid
            AND configuration_name = 'pos_runtime'
          LIMIT 1`,
        [storeId],
      );
      const row = rows[0];
      if (!row?.configuration_value) return null;
      return {
        ...row.configuration_value,
        storeId,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  private async saveConfig(config: PosConfigEntity): Promise<PosConfigEntity> {
    if (this.isDbConnected && this.dataSource && STORE_UUID.test(config.storeId)) {
      const payload = { ...config };
      delete (payload as { createdAt?: Date }).createdAt;
      delete (payload as { updatedAt?: Date }).updatedAt;
      const rows: Array<{ created_at: Date; updated_at: Date }> = await this.dataSource.query(
        `INSERT INTO public.store_pos_configurations (store_id, configuration_name, configuration_value)
         VALUES ($1::uuid, 'pos_runtime', $2::jsonb)
         ON CONFLICT (store_id, configuration_name) DO UPDATE
           SET configuration_value = EXCLUDED.configuration_value,
               updated_at = now()
         RETURNING created_at, updated_at`,
        [config.storeId, JSON.stringify(payload)],
      );
      const saved = { ...config, createdAt: rows[0]?.created_at || config.createdAt, updatedAt: rows[0]?.updated_at || new Date() };
      await this.cacheConfig(saved);
      return saved;
    }
    this.memoryConfigs.set(config.storeId, config);
    return config;
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
