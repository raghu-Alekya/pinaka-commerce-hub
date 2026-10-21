import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

const money = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | number | null) => (value == null || value === '' ? null : Number(value)),
};

@Entity('pos_shift_transactions')
export class PosShiftTransactionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  shift_id!: string;

  @Column({ type: 'varchar', length: 50 })
  transaction_type!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: money })
  total_sum!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  json_payload!: unknown;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  updated_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
