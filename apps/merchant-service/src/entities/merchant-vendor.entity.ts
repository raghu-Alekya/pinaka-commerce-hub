import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { VendorEntity } from './vendor.entity';

export enum MerchantVendorStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('merchant_vendors')
@Unique('merchant_vendors_merchant_vendor_uidx', ['merchantId', 'vendorId'])
@Index('pch_merchant_vendors_vendor', ['vendorId'])
export class MerchantVendorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_id' })
  vendor?: VendorEntity;

  @Column({ type: 'varchar', length: 20, default: MerchantVendorStatus.ACTIVE })
  status!: MerchantVendorStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
