import type { DataSource } from 'typeorm';

export class AnalyticsSnapshotEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.analytics_daily_snapshots RESTRICT');
  }


  id!: string; // e.g. "SNAP-2026-09-03-STR-5001"

  merchantId!: string;

  storeId!: string;

  dateString!: string; // e.g. "2026-09-03"

  totalGrossSales!: number;

  totalNetSales!: number;

  totalOrdersCount!: number;

  averageOrderValue!: number;

  totalTaxCollected!: number;

  totalDiscountsGiven!: number;

  channelBreakdown!: Record<string, number>; // { POS: 1250.00, WOOCOMMERCE: 480.00, DOORDASH: 320.00 }

  topProducts!: any[];

  createdAt!: Date;

  updatedAt!: Date;
}
