import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, PermissionType, RecordStatus } from './commerce-enums';
import { FeatureEntity } from './feature.entity';

@Entity('feature_permissions')
export class FeaturePermissionEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'feature_id', type: 'uuid' })
  featureId!: string;

  @ManyToOne(() => FeatureEntity)
  @JoinColumn({ name: 'feature_id' })
  feature?: FeatureEntity;

  @Column({ name: 'permission_code', type: 'varchar', length: 100, unique: true })
  permissionCode!: string;

  @Column({ name: 'permission_type', type: 'enum', enum: PermissionType, enumName: 'permission_type' })
  permissionType!: PermissionType;

  @Column({ name: 'name', type: 'varchar', length: 150 })
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
