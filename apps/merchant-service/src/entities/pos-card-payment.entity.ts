import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_card_payment_settings')
@Index('pos_card_payment_settings_store_provider_uq', ['storeId', 'provider'], { unique: true })
export class PosCardPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 20 })
  provider!: string;

  @Column({ type: 'varchar', length: 100 })
  deviceId!: string;

  @Column({ type: 'varchar', length: 100 })
  processorMerchantId!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  terminalId!: string;

  @Column({ type: 'varchar', length: 500 })
  secretKey!: string;

  @Column({ type: 'varchar', length: 2048 })
  webhookUrl!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
