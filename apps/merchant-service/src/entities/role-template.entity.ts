import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, RecordStatus, ScopeType } from './commerce-enums';

export { RecordStatus as RoleTemplateStatus, ScopeType as RoleScopeType } from './commerce-enums';

@Entity('role_templates')
export class RoleTemplateEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_code', type: 'varchar', length: 50, unique: true })
  roleCode!: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description!: string;

  @Column({
    name: 'scope_type',
    type: 'enum',
    enum: ScopeType,
    enumName: 'scope_type',
    default: ScopeType.STORE,
  })
  scopeType!: ScopeType;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
