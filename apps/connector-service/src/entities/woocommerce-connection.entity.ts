import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('woocommerce_connections')
export class WooCommerceConnectionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "WC-CONN-1001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 255 })
  storeUrl!: string; // e.g. "https://pch.alekyatechsolutions.com"

  @Column({ type: 'varchar', length: 255 })
  consumerKey!: string; // e.g. "ck_12345..."

  @Column({ type: 'varchar', length: 255 })
  consumerSecret!: string; // e.g. "cs_67890..."

  @Column({ type: 'varchar', length: 255, nullable: true })
  webhookSecret?: string;

  @Column({ type: 'boolean', default: true })
  autoSyncInventory!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'ACTIVE' })
  syncStatus!: string; // 'ACTIVE' | 'PAUSED' | 'ERROR'

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
