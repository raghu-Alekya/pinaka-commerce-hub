import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  USER = 'USER',
}

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) username?: string | null;
  @Column({ name: 'merchant_id', type: 'varchar', length: 100, nullable: true }) merchantId?: string | null;
  @Column({ name: 'employee_id', type: 'uuid', nullable: true }) employeeId?: string | null;
  @Column({ name: 'account_id', type: 'uuid', nullable: true }) accountId?: string | null;
  @Column({ name: 'first_name', type: 'varchar', length: 100 }) firstName!: string;
  @Column({ name: 'last_name', type: 'varchar', length: 100 }) lastName!: string;
  @Column({ type: 'varchar', length: 255, unique: true }) email!: string;
  @Column({ name: 'phone_number', type: 'varchar', length: 30 }) phoneNumber!: string;
  @Column({ type: 'varchar', length: 20, default: UserRole.USER })
  role!: UserRole;
  @Column({ name: 'notification_enabled', type: 'boolean', default: true }) notificationEnabled!: boolean;
  @Column({ type: 'varchar', length: 20, default: UserStatus.ACTIVE })
  status!: UserStatus;
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash?: string | null;
  @Column({ name: 'action_token_hash', type: 'varchar', length: 64, nullable: true, select: false })
  actionTokenHash?: string | null;
  @Column({ name: 'action_token_type', type: 'varchar', length: 20, nullable: true, select: false })
  actionTokenType?: 'INVITE' | 'RESET' | null;
  @Column({ name: 'action_token_expires_at', type: 'timestamp', nullable: true, select: false })
  actionTokenExpiresAt?: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
