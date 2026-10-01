import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Audited, AuditColumns, BillingCycle, SubscriptionStatus } from './commerce-enums';
import { MerchantEntity } from './merchant.entity';
import { PlanEntity } from './plan.entity';

export { SubscriptionStatus, BillingCycle } from './commerce-enums';

/** Codes for the subscription_plans catalog. Not a column on subscriptions. */
export enum PlanCode {
  STARTER = 'STARTER',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

const numericPrice = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

@Entity('subscriptions')
@Audited()
export class SubscriptionEntity extends AuditColumns {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 100 })
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => MerchantEntity)
  @JoinColumn({ name: 'merchant_id', referencedColumnName: 'id' })
  merchant?: MerchantEntity;

  @Column({ name: 'subscription_code', type: 'varchar', length: 100, unique: true })
  subscriptionCode!: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId?: string | null;

  @ManyToOne(() => PlanEntity, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan?: PlanEntity;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: string | null;

  @Column({ name: 'renewal_date', type: 'date', nullable: true })
  renewalDate?: string | null;

  @Column({ name: 'trial_end_date', type: 'date', nullable: true })
  trialEndDate?: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Column({ name: 'entitlements', type: 'jsonb', default: () => "'[]'" })
  entitlements!: unknown[];

  @Column({
    name: 'billing_cycle',
    type: 'enum',
    enum: BillingCycle,
    enumName: 'billing_cycle',
    default: BillingCycle.MONTHLY,
  })
  billingCycle!: BillingCycle;

  @Column({ name: 'price', type: 'numeric', precision: 10, scale: 2, transformer: numericPrice })
  price!: number;

  @Column({ name: 'auto_renew', type: 'boolean', default: true })
  autoRenew!: boolean;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status',
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;
}
