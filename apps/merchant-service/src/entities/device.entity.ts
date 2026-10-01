import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, RecordStatus } from './commerce-enums';
import { MerchantEntity } from './merchant.entity';

@Entity('devices')
export class DeviceEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'device_code', type: 'varchar', length: 100, unique: true })
  deviceCode!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => MerchantEntity)
  @JoinColumn({ name: 'merchant_id', referencedColumnName: 'id' })
  merchant?: MerchantEntity;

  @Column({ name: 'merchant_name', type: 'varchar', length: 255 })
  merchantName!: string;

  @Column({ name: 'serial_number', type: 'varchar', length: 100, unique: true })
  serialNumber!: string;

  @Column({ name: 'device_name', type: 'varchar', length: 255 })
  deviceName!: string;

  @Column({ name: 'device_type', type: 'varchar', length: 100 })
  deviceType!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
