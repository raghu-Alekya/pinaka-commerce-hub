import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('analytics_daily_snapshots')
export class AnalyticsSnapshotEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SNAP-2026-09-03-STR-5001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50 })
  dateString!: string; // e.g. "2026-09-03"

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalGrossSales!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalNetSales!: number;

  @Column({ type: 'integer', default: 0 })
  totalOrdersCount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  averageOrderValue!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalTaxCollected!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalDiscountsGiven!: number;

  @Column({ type: 'jsonb' })
  channelBreakdown!: Record<string, number>; // { POS: 1250.00, WOOCOMMERCE: 480.00, DOORDASH: 320.00 }

  @Column({ type: 'jsonb' })
  topProducts!: any[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
