import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_cash_registers')
@Index('pos_cash_registers_parent_idx', ['registerSettingsId', 'sortOrder'])
export class PosCashRegisterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  registerSettingsId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  pos!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  maxCash!: string;

  @Column({ type: 'boolean', default: true })
  safeDrop!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'Active' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
