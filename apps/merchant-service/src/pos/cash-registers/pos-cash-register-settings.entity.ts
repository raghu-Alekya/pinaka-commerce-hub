import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_cash_register_settings')
@Index('pos_cash_register_settings_store_uq', ['storeId'], { unique: true })
export class PosCashRegisterSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
