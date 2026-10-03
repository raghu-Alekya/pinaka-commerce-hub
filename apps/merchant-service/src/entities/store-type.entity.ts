import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';

export { RecordStatus as StoreTypeStatus } from './commerce-enums';

@Entity('store_types')
@Audited()
export class StoreTypeEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'store_type_code',
    type: 'varchar',
    length: 50,
    unique: true,
    insert: false,
    update: false,
  })
  storeTypeCode!: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
