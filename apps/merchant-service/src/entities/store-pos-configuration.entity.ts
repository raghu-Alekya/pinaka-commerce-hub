import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('store_pos_configurations')
@Unique(
  'uq_store_pos_configuration_store_name',
  ['storeId', 'configurationName'],
)
@Index(
  'idx_store_pos_configurations_store_id',
  ['storeId'],
)
export class StorePosConfigurationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Store ID
   * References stores.id
   * 
   */
  @Column({
    name: 'store_id',
    type: 'uuid',
  })
  storeId!: string;

  /**
   * POS configuration name.
   *
   * currency_taxes
   * service_charges
   * cashback_settings
   * opening_balance
   * cash_denominations
   * cash_register_settings
   * safe_and_safe_drop
   * card_payment_settings
   * terminal_register_mapping
   */
  @Column({
    name: 'configuration_name',
    type: 'varchar',
    length: 100,
  })
  configurationName!: string;

  /**
   * Configuration-specific JSON data.
   */
  @Column({
    name: 'configuration_value',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  configurationValue!: Record<string, unknown>;

  /**
   * Account that created this configuration.
   */
  @Column({
    name: 'created_by',
    type: 'uuid',
    nullable: true,
  })
  createdBy?: string | null;

  /**
   * Account that last updated this configuration.
   */
  @Column({
    name: 'updated_by',
    type: 'uuid',
    nullable: true,
  })
  updatedBy?: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt!: Date;
}