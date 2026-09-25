import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_opening_balance_settings')
@Index('pos_opening_balance_settings_store_uq', ['storeId'], { unique: true })
export class PosOpeningBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'boolean', default: true })
  requireOpeningBalance!: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 4, default: 0 })
  defaultOpeningAmount!: string;

  @Column({ type: 'boolean', default: true })
  managerApprovalRequired!: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 4, default: 0 })
  varianceTolerance!: string;

  @Column({ type: 'boolean', default: false })
  allowCashierOverride!: boolean;

  @Column({ type: 'boolean', default: true })
  countByDenomination!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
