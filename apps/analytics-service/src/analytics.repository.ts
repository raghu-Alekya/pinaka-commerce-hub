import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { AnalyticsSnapshotEntity } from './entities/analytics-snapshot.entity';

@Injectable()
export class AnalyticsRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private snapRepo?: Repository<AnalyticsSnapshotEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  public isRedisConnected = false;

  private inMemorySnapshot: AnalyticsSnapshotEntity = {
    id: 'SNAP-2026-09-03-STR-5001',
    merchantId: 'MCH-1001',
    storeId: 'STR-5001',
    dateString: '2026-09-03',
    totalGrossSales: 2450.80,
    totalNetSales: 2263.20,
    totalOrdersCount: 48,
    averageOrderValue: 51.05,
    totalTaxCollected: 187.60,
    totalDiscountsGiven: 45.00,
    channelBreakdown: {
      IN_STORE_POS: 1450.00,
      WOOCOMMERCE: 680.00,
      DOORDASH: 220.80,
      UBER_EATS: 100.00,
    },
    topProducts: [
      { productId: 'MILK-ORG-1G', productName: 'Organic Whole Milk 1 Gal', unitsSold: 34, totalRevenue: 186.66 },
      { productId: 'ITEM-101', productName: 'Cheeseburger Deluxe', unitsSold: 28, totalRevenue: 419.72 },
      { productId: 'ITEM-102', productName: 'Truffle Fries', unitsSold: 20, totalRevenue: 170.00 },
      { productId: '4131', productName: 'Gala Apples (PLU 4131)', unitsSold: 45, totalRevenue: 89.55 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async onModuleInit() {
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [AnalyticsSnapshotEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.snapRepo = this.dataSource.getRepository(AnalyticsSnapshotEntity);
      this.isDbConnected = true;
      console.log('🐘 [Analytics Service DB] Connected to PostgreSQL Database');
      await this.seedSnapshot();
    } catch (err: any) {
      console.log(`⚠️ [Analytics Service DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
    }

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [Analytics Service Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Analytics Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedSnapshot() {
    if (this.snapRepo) {
      const existing = await this.snapRepo.findOne({ where: { id: 'SNAP-2026-09-03-STR-5001' } });
      if (!existing) {
        const entity = this.snapRepo.create(this.inMemorySnapshot);
        await this.snapRepo.save(entity);
        console.log('📈 [Analytics Service] Seeded default daily financial analytics snapshot');
      }
    }
  }

  async getDashboardKpis(storeId: string): Promise<AnalyticsSnapshotEntity> {
    if (this.isDbConnected && this.snapRepo) {
      const snap = await this.snapRepo.findOne({ where: { storeId } });
      if (snap) return snap;
    }
    return this.inMemorySnapshot;
  }

  async getTopProducts(storeId: string): Promise<any[]> {
    const kpis = await this.getDashboardKpis(storeId);
    return kpis.topProducts || [];
  }

  async getChannelBreakdown(storeId: string): Promise<Record<string, number>> {
    const kpis = await this.getDashboardKpis(storeId);
    return kpis.channelBreakdown || {};
  }
}
