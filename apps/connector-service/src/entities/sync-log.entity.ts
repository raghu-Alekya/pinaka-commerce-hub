import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SyncLogStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'DLQ_RETRY';

@Entity('sync_logs')
export class SyncLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SYNC-1725280000000-abcd"

  @Column({ type: 'varchar', length: 100, nullable: true })
  merchantId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  storeId?: string;

  @Column({ type: 'varchar', length: 50, default: 'WOOCOMMERCE' })
  source!: string; // 'WOOCOMMERCE' | 'DOORDASH' | 'UBER_EATS' | 'SWIGGY' | 'POS'

  @Column({ type: 'varchar', length: 50 })
  entityType!: string; // 'PRODUCT' | 'ORDER' | 'INVENTORY' | 'CATEGORY'

  @Column({ type: 'varchar', length: 150 })
  entityId!: string; // e.g. WooCommerce product/order ID or SKU

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status!: SyncLogStatus;

  @Column({ type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  errorDetails?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
