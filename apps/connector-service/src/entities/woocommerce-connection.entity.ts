import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('woocommerce_connections')
export class WooCommerceConnectionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "WC-CONN-1001"

  @Column({ name: 'merchant_id', type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ name: 'store_id', type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ name: 'store_url', type: 'varchar', length: 255 })
  storeUrl!: string; // e.g. "https://pch.alekyatechsolutions.com"

  @Column({ name: 'consumer_key', type: 'varchar', length: 255 })
  consumerKey!: string; // e.g. "ck_12345..."

  @Column({ name: 'consumer_secret', type: 'varchar', length: 255 })
  consumerSecret!: string; // e.g. "cs_67890..."

  @Column({ name: 'webhook_secret', type: 'varchar', length: 255, nullable: true })
  webhookSecret?: string;

  @Column({ name: 'auto_sync_inventory', type: 'boolean', default: true })
  autoSyncInventory!: boolean;

  @Column({ name: 'sync_status', type: 'varchar', length: 50, default: 'ACTIVE' })
  syncStatus!: string; // 'ACTIVE' | 'PAUSED' | 'ERROR'

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
