import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum StoreStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export enum OperationalStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PAUSED = 'PAUSED',
}

export interface StoreAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: { latitude: number; longitude: number };
}

export interface StoreChannelConfig {
  platform: string; // 'DOORDASH' | 'UBER_EATS' | 'POS' | 'WOOCOMMERCE'
  externalStoreId: string;
  apiKey: string;
  enabled: boolean;
}

@Entity('stores')
export class StoreEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "STR-5001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string; // Foreign Key to merchants.id

  @Column({ type: 'varchar', length: 255 })
  storeName!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  storeCode!: string; // e.g. "STR-DT-01"

  @Column({ type: 'varchar', length: 50, default: 'RETAIL' })
  storeType!: string; // 'RETAIL' | 'GROCERY' | 'RESTAURANT'

  @Column({ type: 'jsonb' })
  address!: StoreAddress;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', length: 100, default: 'America/Chicago' })
  timezone!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 8.25 })
  taxRate!: number;

  @Column({ type: 'varchar', length: 10 })
  activationPin!: string; // 6-digit PIN used by Flutter POS terminal to pair with store

  @Column({ type: 'boolean', default: true })
  autoAcceptOrders!: boolean;

  @Column({ type: 'varchar', length: 50, default: StoreStatus.ACTIVE })
  status!: StoreStatus;

  @Column({ type: 'varchar', length: 50, default: OperationalStatus.OPEN })
  operationalStatus!: OperationalStatus;

  @Column({ type: 'jsonb', default: [] })
  channels!: StoreChannelConfig[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
