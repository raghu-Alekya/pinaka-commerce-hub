import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

const deletedFlag = {
  name: 'is_deleted',
  type: 'boolean' as const,
  default: false,
  transformer: {
    to: (value: unknown) => value === true || value === 1 || value === '1',
    from: (value: unknown) => value === true,
  },
};

/**
 * Registers audit columns after the entity's own columns.
 * A base-class column decorator is recorded first, which puts these fields at the front of CREATE TABLE.
 */
export function Audited(): ClassDecorator {
  return (target) => {
    const prototype = (target as { prototype: object }).prototype;
    Column({ name: 'created_by', type: 'uuid', nullable: true })(prototype, 'createdBy');
    Column({ name: 'updated_by', type: 'uuid', nullable: true })(prototype, 'updatedBy');
    CreateDateColumn({ name: 'created_at', type: 'timestamptz' })(prototype, 'createdAt');
    UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })(prototype, 'updatedAt');
    Column(deletedFlag)(prototype, 'isDeleted');
  };
}

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
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  isDeleted!: boolean;
}
