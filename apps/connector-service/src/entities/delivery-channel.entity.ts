import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum DeliveryChannel {
  DOORDASH = 'DOORDASH',
  UBER_EATS = 'UBER_EATS',
  SWIGGY = 'SWIGGY',
  ZOMATO = 'ZOMATO',
  INSTACART = 'INSTACART',
  SHOPIFY = 'SHOPIFY',
}

@Entity('delivery_channel_configs')
export class DeliveryChannelEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "CHAN-6001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50 })
  channel!: DeliveryChannel;

  @Column({ type: 'varchar', length: 100 })
  externalStoreId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  webhookSecret?: string;

  @Column({ type: 'boolean', default: true })
  autoAccept!: boolean;

  @Column({ type: 'integer', default: 20 })
  defaultPrepTimeMinutes!: number;

  @Column({ type: 'boolean', default: true })
  isEnabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
