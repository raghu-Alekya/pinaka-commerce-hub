import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, RecordStatus } from './commerce-enums';
import { FeaturePermissionEntity } from './feature-permission.entity';
import { RoleTemplateEntity } from './role-template.entity';

@Entity('role_template_permissions')
export class RoleTemplatePermissionEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_template_id', type: 'uuid' })
  roleTemplateId!: string;

  @ManyToOne(() => RoleTemplateEntity)
  @JoinColumn({ name: 'role_template_id' })
  roleTemplate?: RoleTemplateEntity;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId!: string;

  @ManyToOne(() => FeaturePermissionEntity)
  @JoinColumn({ name: 'permission_id' })
  permission?: FeaturePermissionEntity;

  @Column({ name: 'default_allowed', type: 'boolean', default: false })
  defaultAllowed!: boolean;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
