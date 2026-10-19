import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum SessionStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity('employee_sessions')
export class EmployeeSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'access_token', type: 'text' })
  accessToken!: string;

  @Column({ name: 'refresh_token', type: 'text' })
  refreshToken!: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string | null;

  @Column({ name: 'merchant_id', type: 'uuid', nullable: true })
  merchantId?: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 100, nullable: true })
  deviceId?: string | null;

  @CreateDateColumn({ name: 'session_created_at' })
  sessionCreatedAt!: Date;

  @UpdateDateColumn({ name: 'session_updated_at' })
  sessionUpdatedAt!: Date;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'Active' })
  status!: string;
}
