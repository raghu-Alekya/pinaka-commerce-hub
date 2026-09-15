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

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceRoleTemplateId?: string | null;

  @Column({ type: 'varchar', length: 50 })
  roleCode!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 20, default: RoleScopeType.STORE })
  scopeType!: RoleScopeType;

  @Column({ type: 'boolean', default: true })
  isCustom!: boolean;

  @Column({ type: 'varchar', length: 20, default: RoleStatus.ACTIVE })
  status!: RoleStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
