import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum PlanStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum PlanBillingModel {
  FLAT = 'FLAT',
  PER_STORE = 'PER_STORE',
  PER_DEVICE = 'PER_DEVICE',
  CUSTOM = 'CUSTOM',
}

export enum PlanBillingCycle {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

@Entity('plans')
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_code', type: 'varchar', length: 50, unique: true })
  planCode!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'billing_model', type: 'varchar', length: 20, default: PlanBillingModel.FLAT })
  billingModel!: PlanBillingModel;

  @Column({ name: 'base_price', type: 'numeric', precision: 12, scale: 2, default: 0 })
  basePrice!: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 20, default: PlanBillingCycle.MONTHLY })
  billingCycle!: PlanBillingCycle;

  @Column({ type: 'varchar', length: 20, default: PlanStatus.ACTIVE })
  status!: PlanStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
