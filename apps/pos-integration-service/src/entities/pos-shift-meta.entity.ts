import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('pos_shift_meta')
export class PosShiftMetaEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  shift_id!: string;

  @Column({ type: 'varchar', length: 100 })
  meta_name!: string;

  @Column({ type: 'jsonb' })
  meta_value!: unknown;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;
}
