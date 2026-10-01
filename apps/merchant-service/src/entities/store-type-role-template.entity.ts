import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, RecordStatus } from './commerce-enums';
import { RoleTemplateEntity } from './role-template.entity';
import { StoreTypeEntity } from './store-type.entity';

@Entity('store_type_role_templates')
export class StoreTypeRoleTemplateEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_type_id', type: 'uuid' })
  storeTypeId!: string;

  @ManyToOne(() => StoreTypeEntity)
  @JoinColumn({ name: 'store_type_id' })
  storeType?: StoreTypeEntity;

  @Column({ name: 'role_template_id', type: 'uuid' })
  roleTemplateId!: string;

  @ManyToOne(() => RoleTemplateEntity)
  @JoinColumn({ name: 'role_template_id' })
  roleTemplate?: RoleTemplateEntity;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
