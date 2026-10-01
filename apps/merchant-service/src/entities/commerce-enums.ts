import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum RecordStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum MerchantStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum StoreStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING',
  EXPIRED = 'EXPIRED',
}

export enum OperationalStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum FeatureType {
  BOOLEAN = 'BOOLEAN',
  LIMIT = 'LIMIT',
  CONFIG = 'CONFIG',
  TEXT = 'TEXT',
}

export enum PermissionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum ScopeType {
  MERCHANT = 'MERCHANT',
  STORE = 'STORE',
}

export enum BillingModel {
  FLAT = 'FLAT',
  PER_STORE = 'PER_STORE',
  PER_DEVICE = 'PER_DEVICE',
  CUSTOM = 'CUSTOM',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUAL = 'ANNUAL',
}

export enum VendorType {
  ORGANIZER = 'ORGANIZER',
  SUPPLIER = 'SUPPLIER',
}

export abstract class AuditColumns {
  @Column({
    name: 'is_deleted',
    type: 'boolean',
    default: false,
    transformer: {
      to: (value: unknown) => value === true || value === 1 || value === '1',
      from: (value: unknown) => value === true,
    },
  })
  isDeleted!: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
