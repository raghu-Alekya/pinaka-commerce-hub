import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_currency_tax_settings')
@Index('pos_currency_tax_settings_store_uq', ['storeId'], { unique: true })
export class PosCurrencyTaxEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 32, default: 'nearest-cent' })
  rounding!: string;

  @Column({ type: 'smallint', default: 2 })
  decimalPlaces!: number;

  @Column({ type: 'boolean', default: true })
  taxEnabled!: boolean;

  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true })
  defaultTaxRate!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'item-price' })
  taxCalculation!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
