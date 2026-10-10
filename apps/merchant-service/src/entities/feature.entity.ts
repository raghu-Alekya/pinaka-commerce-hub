import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';

export { RecordStatus as FeatureStatus } from './commerce-enums';

@Entity('features')
@Audited()
export class FeatureEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'feature_code', type: 'varchar', length: 100, unique: true })
  featureCode!: string;

  get featureKey(): string {
    return this.featureCode;
  }

  set featureKey(value: string) {
    if (value) this.featureCode = value;
  }

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description!: string;

  @Column({ name: 'feature_type', type: 'varchar', length: 100 })
  featureType!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
