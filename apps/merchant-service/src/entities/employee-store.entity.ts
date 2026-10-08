import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

@Entity('employee_stores')
@Unique('uq_employee_store', ['employeeId', 'storeId'])
export class EmployeeStoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ name: 'login_pin_hash', type: 'varchar', length: 128, nullable: true, select: false })
  loginPinHash?: string | null;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
