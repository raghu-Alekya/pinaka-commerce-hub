import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';
import { FeatureEntity } from './feature.entity';
import { StoreTypeEntity } from './store-type.entity';

@Entity('store_type_features')
@Audited()
export class StoreTypeFeatureEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_type_id', type: 'uuid' })
  storeTypeId!: string;

  @ManyToOne(() => StoreTypeEntity)
  @JoinColumn({ name: 'store_type_id' })
  storeType?: StoreTypeEntity;

  @Column({ name: 'feature_id', type: 'uuid' })
  featureId!: string;

  @ManyToOne(() => FeatureEntity)
  @JoinColumn({ name: 'feature_id' })
  feature?: FeatureEntity;

  @Column({ name: 'required', type: 'boolean', default: false })
  required!: boolean;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
