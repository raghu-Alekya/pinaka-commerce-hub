import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';

export { RecordStatus as TendorStatus } from './commerce-enums';

@Entity('tendors')
@Audited()
export class TendorEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tendor_code', type: 'varchar', length: 50, unique: true })
  tendorCode!: string;

  @Column({ name: 'tendor_name', type: 'varchar', length: 150 })
  tendorName!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
