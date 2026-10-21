import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

const money = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | number | null) => (value == null || value === '' ? null : Number(value)),
};

@Entity('pos_shifts')
export class PosShiftEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  merchant_id!: string;

  @Column({ type: 'varchar', length: 100 })
  store_id!: string;

  @Column({ type: 'varchar', length: 100 })
  device_id!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  opening_device_id?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  closing_device_id?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  updated_by?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  closed_by?: string | null;

  @Column({ type: 'varchar', length: 50, default: ShiftStatus.OPEN })
  status!: ShiftStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, transformer: money })
  opening_balance!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: money })
  closing_balance?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: money })
  over_short?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: money })
  declared_cash?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: money })
  discrepancy?: number | null;

  @Column({ type: 'timestamptz' })
  opened_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
