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

  @Column({ type: 'varchar', length: 50, unique: true })
  planCode!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 20, default: PlanBillingModel.FLAT })
  billingModel!: PlanBillingModel;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  basePrice!: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: PlanBillingCycle.MONTHLY })
  billingCycle!: PlanBillingCycle;

  @Column({ type: 'varchar', length: 20, default: PlanStatus.ACTIVE })
  status!: PlanStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
