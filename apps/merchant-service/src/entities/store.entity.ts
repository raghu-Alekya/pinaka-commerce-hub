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

export interface StoreWebsiteConnectorConfig {
  provider: 'WORDPRESS';
  wordpressUrl: string;
  encryptedJwt: string;
  updatedAt: string;
}

@Entity('stores')
export class StoreEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "STR-5001" or "STR-50069"

  @Column({ name: 'merchant_id', type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ name: 'store_type_id', type: 'varchar', length: 50, default: 'RETAIL' })
  storeType!: string; // e.g. 'RETAIL' | 'GROCERY' | 'RESTAURANT'

  @Column({ name: 'store_code', type: 'varchar', length: 50, unique: true })
  storeCode!: string; // e.g. "ST-001"

  @Column({ name: 'name', type: 'varchar', length: 255 })
  storeName!: string;

  @Column({ type: 'varchar', length: 100, default: 'UTC' })
  timezone!: string;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ type: 'jsonb', default: {} })
  address!: StoreAddress;

  @Column({ name: 'woocommerce_store_id', type: 'varchar', length: 100, nullable: true })
  woocommerceStoreId?: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  baseUrl?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 8.25 })
  taxRate!: number;

  @Column({ type: 'varchar', length: 10, default: '123456' })
  activationPin!: string;

  @Column({ type: 'boolean', default: true })
  autoAcceptOrders!: boolean;

  @Column({ type: 'varchar', length: 50, default: StoreStatus.ACTIVE })
  status!: StoreStatus;

  @Column({ type: 'varchar', length: 50, default: OperationalStatus.OPEN })
  operationalStatus!: OperationalStatus;

  @Column({ type: 'jsonb', default: [] })
  channels!: StoreChannelConfig[];

  @Column({ type: 'jsonb', nullable: true, select: false })
  websiteConnector?: StoreWebsiteConnectorConfig | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
