import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum RoleTemplateStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum RoleScopeType {
  MERCHANT = 'MERCHANT',
  STORE = 'STORE',
}

@Entity('role_templates')
export class RoleTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_code', type: 'varchar', length: 50, unique: true })
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
