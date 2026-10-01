import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, OperationalStatus, StoreStatus } from './commerce-enums';
import { MerchantEntity } from './merchant.entity';
import { StoreTypeEntity } from './store-type.entity';

export { StoreStatus, OperationalStatus } from './commerce-enums';

export interface StoreAddress {
  street: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: { latitude: number; longitude: number };
}

export interface StoreChannelConfig {
  platform: string;
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
export class StoreEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => MerchantEntity)
  @JoinColumn({ name: 'merchant_id', referencedColumnName: 'id' })
  merchant?: MerchantEntity;

  @Column({ name: 'store_type_id', type: 'uuid' })
  storeTypeId!: string;

  @ManyToOne(() => StoreTypeEntity)
  @JoinColumn({ name: 'store_type_id' })
  storeType?: StoreTypeEntity;

  @Column({ name: 'store_code', type: 'varchar', length: 50, unique: true })
  storeCode!: string;

  @Column({ name: 'store_name', type: 'varchar', length: 255 })
  storeName!: string;

  @Column({ name: 'store_website_url', type: 'varchar', length: 2048, unique: true, nullable: true })
  storeWebsiteUrl?: string | null;

  @Column({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode?: string | null;

  @Column({ name: 'state', type: 'varchar', length: 100, nullable: true })
  state?: string | null;

  @Column({ name: 'city', type: 'varchar', length: 100, nullable: true })
  city?: string | null;

  @Column({ name: 'country', type: 'varchar', length: 100, nullable: true })
  country?: string | null;

  @Column({ name: 'phone', type: 'varchar', length: 50, nullable: true })
  phone?: string | null;

  @Column({ name: 'store_email', type: 'varchar', length: 255, nullable: true })
  storeEmail?: string | null;

  @Column({ name: 'currency', type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ name: 'timezone', type: 'varchar', length: 100, default: 'UTC' })
  timezone!: string;

  @Column({ name: 'activation_pin', type: 'varchar', length: 10 })
  activationPin!: string;

  @Column({
    name: 'operational_status',
    type: 'enum',
    enum: OperationalStatus,
    enumName: 'operational_status',
    default: OperationalStatus.OPEN,
  })
  operationalStatus!: OperationalStatus;

  @Column({ name: 'channels', type: 'jsonb', default: () => "'[]'" })
  channels!: StoreChannelConfig[];

  @Column({ name: 'website_connector', type: 'jsonb', nullable: true })
  websiteConnector?: StoreWebsiteConnectorConfig | null;

  @Column({ name: 'onboarding_setup', type: 'jsonb', default: () => "'{}'" })
  onboardingSetup!: Record<string, unknown>;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StoreStatus,
    enumName: 'store_status',
    default: StoreStatus.ACTIVE,
  })
  status!: StoreStatus;
}
