import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { RoleScopeType } from './role-template.entity';

export enum RoleStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'varchar', length: 100 })
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

  @Column({ name: 'is_custom', type: 'boolean', default: true })
  isCustom!: boolean;

  @Column({ type: 'varchar', length: 20, default: RoleStatus.ACTIVE })
  status!: RoleStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
