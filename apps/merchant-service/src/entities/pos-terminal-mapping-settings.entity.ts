import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_terminal_mapping_settings')
@Index('pos_terminal_mapping_settings_store_uq', ['storeId'], { unique: true })
export class PosTerminalMappingSettingsEntity {
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
