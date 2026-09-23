import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { RoleScopeType, RoleTemplateStatus } from './role-template.entity';

@Entity('merchant_role_templates')
export class MerchantRoleTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ name: 'source_role_template_id', type: 'uuid', nullable: true })
  sourceRoleTemplateId?: string | null;

  @Column({ name: 'role_code', type: 'varchar', length: 50 })
  roleCode!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 20, default: RoleScopeType.STORE })
  scopeType!: RoleScopeType;

  @Column({ type: 'varchar', length: 20, default: RoleTemplateStatus.ACTIVE })
  status!: RoleTemplateStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
