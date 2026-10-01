import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, BillingCycle, BillingModel, RecordStatus } from './commerce-enums';
import { StoreTypeEntity } from './store-type.entity';

export {
  RecordStatus as PlanStatus,
  BillingModel as PlanBillingModel,
  BillingCycle as PlanBillingCycle,
} from './commerce-enums';

@Entity('plans')
@Audited()
export class PlanEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_code', type: 'varchar', length: 50, unique: true })
  planCode!: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description!: string;

  @Column({
    name: 'billing_model',
    type: 'enum',
    enum: BillingModel,
    enumName: 'billing_model',
    default: BillingModel.FLAT,
  })
  billingModel!: BillingModel;

  @Column({ name: 'base_price', type: 'numeric', precision: 12, scale: 2, default: 0 })
  basePrice!: number;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({
    name: 'billing_cycle',
    type: 'enum',
    enum: BillingCycle,
    enumName: 'billing_cycle',
    default: BillingCycle.MONTHLY,
  })
  billingCycle!: BillingCycle;

  @Column({ name: 'store_type_id', type: 'uuid', nullable: true })
  storeTypeId?: string | null;

  @ManyToOne(() => StoreTypeEntity, { nullable: true })
  @JoinColumn({ name: 'store_type_id' })
  storeType?: StoreTypeEntity;

  @Column({ name: 'stores_limit', type: 'integer', default: 0 })
  storesLimit!: number;

  @Column({ name: 'terminal_limit', type: 'integer', default: 0 })
  terminalLimit!: number;

  @Column({ name: 'additional_terminal_price', type: 'numeric', precision: 12, scale: 2, default: 0 })
  additionalTerminalPrice!: number;

  @Column({ name: 'employees_limit', type: 'integer', default: 0 })
  employeesLimit!: number;

  @Column({ name: 'additional_employee_price', type: 'numeric', precision: 12, scale: 2, default: 0 })
  additionalEmployeePrice!: number;

  @Column({ name: 'trial_period', type: 'integer', default: 0 })
  trialPeriod!: number;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom?: Date | null;

  @Column({ name: 'plan_end_date', type: 'timestamptz', nullable: true })
  planEndDate?: Date | null;

  @Column({ name: 'included_features', type: 'text', array: true, default: () => "'{}'" })
  includedFeatures!: string[];

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
