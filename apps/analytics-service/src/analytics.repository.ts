import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { AnalyticsSnapshotEntity } from './entities/analytics-snapshot.entity';

@Injectable()
export class AnalyticsRepository implements OnModuleInit {
  private dataSource!: DataSource;
  private snapRepo!: Repository<AnalyticsSnapshotEntity>;
  private redisClient?: Redis;
  isDbConnected = false;
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
    this.dataSource = await connectPostgres('Analytics Service DB', [AnalyticsSnapshotEntity]);
    this.snapRepo = this.dataSource.getRepository(AnalyticsSnapshotEntity);
    this.isDbConnected = true;
    await this.seedSnapshot();

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
    const snap =
      (await this.snapRepo.findOne({ where: { storeId } })) ||
      (await this.snapRepo.findOne({ where: { id: this.inMemorySnapshot.id } }));
    if (!snap) throw new Error(`No analytics snapshot found for store '${storeId}'`);
    return snap;
  }

  async getTopProducts(storeId: string): Promise<any[]> {
    const kpis = await this.getDashboardKpis(storeId);
    return kpis.topProducts || [];
  }

  async getChannelBreakdown(storeId: string): Promise<Record<string, number>> {
    const kpis = await this.getDashboardKpis(storeId);
    return kpis.channelBreakdown || {};
  }

  async querySalesReport(storeId: string, merchantId: string, timezone: string, startDate: string, endDate: string) {
    return this.dataSource.query(`
      SELECT (created_at AT TIME ZONE $3)::date::text AS local_date,
             COUNT(*)::int AS orders,
             COALESCE(SUM(total), 0)::numeric(14,2)::text AS sales
        FROM public.store_orders
       WHERE store_id = $1
         AND merchant_id = $2
         AND lower(status) IN ('completed', 'processing')
         AND (created_at AT TIME ZONE $3)::date >= $4::date
         AND (created_at AT TIME ZONE $3)::date <= $5::date
       GROUP BY 1
       ORDER BY 1
    `, [storeId, merchantId, timezone, startDate, endDate]) as Promise<Array<{ local_date: string; orders: number; sales: string }>>;
  }

  async getStoreReportTimezone(storeId: string): Promise<string | undefined> {
    const rows = await this.dataSource.query(`
      SELECT timezone FROM public.store_orders
       WHERE store_id = $1 AND NULLIF(timezone, '') IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1
    `, [storeId]) as Array<{ timezone: string }>;
    return rows[0]?.timezone;
  }

  async queryShiftSales(storeId: string, merchantId: string, timezone: string, date: string) {
    return this.dataSource.query(`
      SELECT shift.id AS shift_id,
             COALESCE(
               NULLIF(BTRIM(CONCAT_WS(' ', opener.first_name, opener.last_name)), ''),
               NULLIF(cashier.meta_value #>> '{}', ''),
               NULLIF(title.meta_value #>> '{}', ''),
               'Unknown'
             ) AS shift_name,
             COUNT(sale.order_id)::int AS orders,
             COALESCE(SUM(sale.total), 0)::numeric(14,2)::text AS sales
        FROM public.pos_shifts AS shift
        LEFT JOIN LATERAL (
          SELECT meta_value
            FROM public.pos_shift_meta
           WHERE shift_id = shift.id AND meta_name = 'user_id' AND status = 'ACTIVE'
           ORDER BY id
           LIMIT 1
        ) AS opener_meta ON true
        LEFT JOIN LATERAL (
          SELECT meta_value
            FROM public.pos_shift_meta
           WHERE shift_id = shift.id AND meta_name = 'cashier_name' AND status = 'ACTIVE'
           ORDER BY id
           LIMIT 1
        ) AS cashier ON true
        LEFT JOIN LATERAL (
          SELECT first_name, last_name
            FROM public.employees AS employee
           WHERE employee.id::text = COALESCE(NULLIF(opener_meta.meta_value #>> '{}', ''), shift.created_by)
              OR to_jsonb(employee)->>'user_id' = COALESCE(NULLIF(opener_meta.meta_value #>> '{}', ''), shift.created_by)
           ORDER BY employee.id
           LIMIT 1
        ) AS opener ON true
        LEFT JOIN LATERAL (
          SELECT meta_value
            FROM public.pos_shift_meta
           WHERE shift_id = shift.id AND meta_name = 'title' AND status = 'ACTIVE'
           ORDER BY id
           LIMIT 1
        ) AS title ON true
        LEFT JOIN public.store_orders AS sale
          ON (sale.shift_id = shift.id OR sale.local_shift_id = shift.id)
         AND sale.store_id::text = shift.store_id
         AND lower(sale.status) = 'completed'
       WHERE shift.store_id = $1
         AND shift.merchant_id = $2
         AND (shift.opened_at AT TIME ZONE $3)::date = $4::date
       GROUP BY shift.id, opener.first_name, opener.last_name, cashier.meta_value, title.meta_value, shift.opened_at
       ORDER BY shift.opened_at ASC, shift.id ASC
    `, [storeId, merchantId, timezone, date]) as Promise<Array<{ shift_id: string; shift_name: string; orders: number; sales: string }>>;
  }
}
