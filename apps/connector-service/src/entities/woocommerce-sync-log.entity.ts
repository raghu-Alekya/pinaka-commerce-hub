import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('woocommerce_sync_logs')
export class WooCommerceSyncLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50 })
  eventType!: string; // 'PRODUCT_SYNC' | 'INVENTORY_SYNC' | 'ORDER_SYNC'

  @Column({ type: 'varchar', length: 100, nullable: true })
  externalId?: string; // WooCommerce Product / Order ID

  @Column({ type: 'varchar', length: 50, default: 'SUCCESS' })
  status!: string; // 'SUCCESS' | 'FAILED'

  @Column({ type: 'text', nullable: true })
  details?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
