import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface FastkeyItem {
  id: string;
  name: string;
  price: number;
  colorHex?: string;
  category: string;
  sku?: string;
  icon?: string;
  sortOrder?: number;
}

export interface DiscountConfig {
  id: string;
  code: string;
  name: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number; // e.g. 10 for 10% or 5 for $5.00
  requiresManagerPin?: boolean;
  active: boolean;
}

export interface PaymentTender {
  id: string;
  code: 'CASH' | 'CARD' | 'SPLIT' | 'UPI' | 'DOORDASH_PAY' | 'CUSTOM';
  name: string;
  enabled: boolean;
  allowSplit: boolean;
  openCashDrawer: boolean;
}

export interface TaxSettings {
  taxName: string; // e.g. "Sales Tax", "GST", "VAT"
  taxRate: number; // e.g. 8.25 for 8.25%
  taxInclusive: boolean;
  roundingRule: 'NEAREST_FIVE_CENTS' | 'EXACT' | 'ROUND_UP';
  receiptHeader: string;
  receiptFooter: string;
}

@Entity('pos_configs')
export class PosConfigEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  storeId!: string; // e.g. "STR-5001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string; // e.g. "MCH-1001"

  @Column({ type: 'varchar', length: 50, default: 'RETAIL' })
  businessType!: string; // 'RETAIL' | 'RESTAURANT'

  @Column({ type: 'jsonb', default: [] })
  fastkeys!: FastkeyItem[];

  @Column({ type: 'jsonb', default: [] })
  discounts!: DiscountConfig[];

  @Column({ type: 'jsonb', default: [] })
  tenders!: PaymentTender[];

  @Column({ type: 'jsonb' })
  taxSettings!: TaxSettings;

  @Column({ type: 'varchar', length: 10, default: '1234' })
  managerPin!: string; // 4-digit PIN for voids & overrides

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
