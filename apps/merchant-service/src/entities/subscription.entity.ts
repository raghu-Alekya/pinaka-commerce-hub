import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum PlanCode {
  STARTER = 'STARTER',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  TRIAL = 'TRIAL',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
}

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SUB-9001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  subscriptionCode?: string | null;

  @Column({ type: 'uuid', nullable: true })
  planId?: string | null;

  @Column({ type: 'date', nullable: true })
  startDate?: string | null;

  @Column({ type: 'date', nullable: true })
  renewalDate?: string | null;

  @Column({ type: 'date', nullable: true })
  trialEndDate?: string | null;

  @Column({ type: 'integer', nullable: true })
  licensedStoreCount?: number | null;

  @Column({ type: 'integer', nullable: true })
  licensedDeviceCount?: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: 'varchar', length: 50, default: PlanCode.PRO })
  planCode!: PlanCode;

  @Column({ type: 'varchar', length: 100 })
  planName!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  storeTypeName?: string | null;

  @Column({ type: 'integer', default: 3 })
  maxStoresAllowed!: number;

  @Column({ type: 'jsonb' })
  entitlements!: string[]; // ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY']

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingCycle!: 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL';

  @Column({ type: 'integer', default: 0 })
  trialDays!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 99.00,
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  price!: number;

  @Column({ type: 'varchar', length: 50, default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodStart?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
