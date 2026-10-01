import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';
import { MerchantEntity } from './merchant.entity';

export { RecordStatus as EmployeeStatus } from './commerce-enums';

@Entity('employees')
@Audited()
export class EmployeeEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_code', type: 'varchar', length: 50, unique: true })
  employeeCode!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => MerchantEntity)
  @JoinColumn({ name: 'merchant_id', referencedColumnName: 'id' })
  merchant?: MerchantEntity;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100, default: '' })
  lastName!: string;

  @Column({ name: 'email', type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ name: 'phone', type: 'varchar', length: 50, nullable: true })
  phone?: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column({ name: 'gender', type: 'varchar', length: 20, nullable: true })
  gender?: string | null;

  @Column({ name: 'address_line1', type: 'varchar', length: 150, default: '' })
  addressLine1!: string;

  @Column({ name: 'address_line2', type: 'varchar', length: 150, default: '' })
  addressLine2!: string;

  @Column({ name: 'city', type: 'varchar', length: 50, default: '' })
  city!: string;

  @Column({ name: 'state', type: 'varchar', length: 50, default: '' })
  state!: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, default: '' })
  postalCode!: string;

  @Column({ name: 'country', type: 'varchar', length: 50, default: '' })
  country!: string;

  @Column({ name: 'username', type: 'varchar', length: 30, nullable: true })
  username?: string | null;

  @Column({ name: 'login_pin_hash', type: 'varchar', length: 128, nullable: true, select: false })
  loginPinHash?: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 128, nullable: true, select: false })
  passwordHash?: string | null;

  @Column({ name: 'send_credentials', type: 'boolean', default: true })
  sendCredentials!: boolean;

  @Column({ name: 'profile_image_url', type: 'varchar', length: 500, nullable: true })
  profileImageUrl?: string | null;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt?: Date | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
