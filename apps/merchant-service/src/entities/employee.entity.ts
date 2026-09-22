import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

@Entity('employees')
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ name: 'employee_code', type: 'varchar', length: 50 })
  employeeCode!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100, default: '' })
  lastName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true }) dateOfBirth?: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) gender?: string | null;
  @Column({ name: 'address_line_1', type: 'varchar', length: 150, default: '' }) addressLine1!: string;
  @Column({ name: 'address_line_2', type: 'varchar', length: 150, default: '' }) addressLine2!: string;
  @Column({ type: 'varchar', length: 50, default: '' }) city!: string;
  @Column({ type: 'varchar', length: 50, default: '' }) state!: string;
  @Column({ name: 'postal_code', type: 'varchar', length: 20, default: '' }) postalCode!: string;
  @Column({ type: 'varchar', length: 50, default: '' }) country!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) username?: string | null;
  @Column({ name: 'login_pin_hash', type: 'varchar', length: 128, nullable: true, select: false }) loginPinHash?: string | null;
  @Column({ name: 'password_hash', type: 'varchar', length: 128, nullable: true, select: false }) passwordHash?: string | null;
  @Column({ name: 'send_credentials', type: 'boolean', default: true }) sendCredentials!: boolean;
  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true }) lastActiveAt?: Date | null;
  @Column({ name: 'profile_image_url', type: 'varchar', length: 500, nullable: true }) profileImageUrl?: string | null;

  @Column({ type: 'varchar', length: 20, default: EmployeeStatus.ACTIVE })
  status!: EmployeeStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
