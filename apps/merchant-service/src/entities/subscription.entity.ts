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
}

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SUB-9001"

  @Column({ type: 'varchar', length: 100, unique: true })
  merchantId!: string;

  @Column({ type: 'varchar', length: 50, default: PlanCode.PRO })
  planCode!: PlanCode;

  @Column({ type: 'varchar', length: 100 })
  planName!: string;

  @Column({ type: 'integer', default: 3 })
  maxStoresAllowed!: number;

  @Column({ type: 'jsonb' })
  entitlements!: string[]; // ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY']

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingCycle!: 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL';

  @Column({ type: 'integer', default: 0 })
  trialDays!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 99.00 })
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
