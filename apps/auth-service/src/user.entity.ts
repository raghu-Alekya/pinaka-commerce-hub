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
  @Column({ type: 'varchar', length: 100, nullable: true }) merchantId?: string | null;
  @Column({ type: 'uuid', nullable: true }) employeeId?: string | null;
  @Column({ type: 'uuid', nullable: true }) accountId?: string | null;
  @Column({ type: 'varchar', length: 100 }) firstName!: string;
  @Column({ type: 'varchar', length: 100 }) lastName!: string;
  @Column({ type: 'varchar', length: 255, unique: true }) email!: string;
  @Column({ type: 'varchar', length: 30 }) phoneNumber!: string;
  @Column({ type: 'varchar', length: 20, default: UserRole.USER })
  role!: UserRole;
  @Column({ type: 'boolean', default: true }) notificationEnabled!: boolean;
  @Column({ type: 'varchar', length: 20, default: UserStatus.ACTIVE })
  status!: UserStatus;
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash?: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  actionTokenHash?: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true, select: false })
  actionTokenType?: 'INVITE' | 'RESET' | null;
  @Column({ type: 'timestamp', nullable: true, select: false })
  actionTokenExpiresAt?: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
