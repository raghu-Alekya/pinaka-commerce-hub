import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditColumns, RecordStatus } from './commerce-enums';
import { MerchantEntity } from './merchant.entity';
import { TendorEntity } from './tendor.entity';

@Entity('merchant_tendors')
export class MerchantTendorEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @ManyToOne(() => MerchantEntity)
  @JoinColumn({ name: 'merchant_id', referencedColumnName: 'id' })
  merchant?: MerchantEntity;

  @Column({ name: 'tendor_id', type: 'uuid' })
  tendorId!: string;

  @ManyToOne(() => TendorEntity)
  @JoinColumn({ name: 'tendor_id' })
  tendor?: TendorEntity;

  @Column({ name: 'tendor_code', type: 'varchar', length: 50, nullable: true })
  tendorCode?: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
