import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_service_charge_settings')
@Index('pos_service_charge_settings_store_uq', ['storeId'], { unique: true })
export class PosServiceChargeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 32, default: 'order-total' })
  applyTo!: string;

  @Column({ type: 'varchar', length: 32, default: 'percentage' })
  defaultType!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4, default: 0 })
  maxLimit!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
