import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum MovementType {
  SAFE_DROP = 'SAFE_DROP',
  PAID_IN = 'PAID_IN',
  PAID_OUT = 'PAID_OUT',
}

@Entity('cash_movements')
export class CashMovementEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ name: 'shift_id', type: 'varchar', length: 100 })
  shiftId!: string;

  @Column({ name: 'store_id', type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ name: 'movement_type', type: 'varchar', length: 50, default: MovementType.SAFE_DROP })
  movementType!: MovementType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ name: 'performed_by', type: 'varchar', length: 255 })
  performedBy!: string; // Cashier / Manager

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
