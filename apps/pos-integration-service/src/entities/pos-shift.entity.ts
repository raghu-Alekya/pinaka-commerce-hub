import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity('pos_shifts')
export class PosShiftEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "SHIFT-8001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  terminalId!: string; // Sunmi Serial # / Device ID

  @Column({ type: 'varchar', length: 150 })
  cashierName!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 200.00 })
  openingCash!: number; // Starting Cash Float

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalCashSales!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalCardSales!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalSafeDrops!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalPaidOuts!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  closingCashActual?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  expectedCashInDrawer?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discrepancy?: number; // Over / Short

  @Column({ type: 'varchar', length: 50, default: ShiftStatus.OPEN })
  status!: ShiftStatus;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
