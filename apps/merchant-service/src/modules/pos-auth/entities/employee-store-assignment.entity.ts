import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('employee_store_assignments')
export class EmployeeStoreAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
