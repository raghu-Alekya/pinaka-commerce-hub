import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';
import { StoreTypeEntity } from './store-type.entity';

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

  @Column({ name: 'store_type_id', type: 'uuid', nullable: true })
  storeTypeId?: string | null;

  @ManyToOne(() => StoreTypeEntity, { nullable: true })
  @JoinColumn({ name: 'store_type_id' })
  storeType?: StoreTypeEntity;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
