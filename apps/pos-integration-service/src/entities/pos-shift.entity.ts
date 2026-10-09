import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export interface DrawerDenomination {
  denomination: number;
  denom_count: number;
}

export interface TubeDenomination {
  denomination: number;
  tube_count: number;
  cell_count: number;
  total: number;
}

export interface ShiftDenominationData {
  drawer_denominations?: DrawerDenomination[];
  drawer_total_amount?: number;
  tube_denominations?: TubeDenomination[];
  tube_total_amount?: number;
  total_amount?: number;
}

@Entity('pos_shifts')
export class PosShiftEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SHIFT-8001"

  @Column({ name: 'merchant_id', type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ name: 'store_id', type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ name: 'register_id', type: 'uuid', nullable: true })
  registerId?: string;

  @Column({ name: 'device_id', type: 'varchar', length: 100 })
  terminalId!: string; // Sunmi Serial # / Device ID

  @Column({ name: 'cashier_name', type: 'varchar', length: 150 })
  cashierName!: string;

  @Column({ name: 'opening_cash', type: 'decimal', precision: 10, scale: 2, default: 200.00 })
  openingCash!: number; // Starting Cash Float

  @Column({ name: 'total_cash_sales', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalCashSales!: number;

  @Column({ name: 'total_card_sales', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalCardSales!: number;

  @Column({ name: 'total_safe_drops', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalSafeDrops!: number;

  @Column({ name: 'total_paid_outs', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalPaidOuts!: number;

  @Column({ type: 'jsonb', nullable: true })
  drawer_denominations?: DrawerDenomination[];

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  drawer_total_amount?: number;

  @Column({ type: 'jsonb', nullable: true })
  tube_denominations?: TubeDenomination[];

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  tube_total_amount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  total_amount?: number;

  @Column({ name: 'closing_cash_actual', type: 'decimal', precision: 10, scale: 2, nullable: true })
  closingCashActual?: number;

  @Column({ name: 'expected_cash_in_drawer', type: 'decimal', precision: 10, scale: 2, nullable: true })
  expectedCashInDrawer?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discrepancy?: number; // Over / Short

  @Column({ type: 'varchar', length: 50, default: ShiftStatus.OPEN })
  status!: ShiftStatus;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
