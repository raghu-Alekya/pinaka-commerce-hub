import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum VendorType {
  ORGANIZER = 'ORGANIZER',
  SUPPLIER = 'SUPPLIER',
}

export enum VendorStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('vendors')
@Index('vendors_vendor_code_active_uidx', ['vendorCode'], {
  unique: true,
  where: `"deletedAt" IS NULL AND "vendorCode" IS NOT NULL AND "vendorCode" <> ''`,
})
export class VendorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  vendorName!: string;

  @Column({ type: 'varchar', length: 20 })
  vendorType!: VendorType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  vendorCode?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  contactPerson?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  productCategory?: string | null;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 20, default: VendorStatus.ACTIVE })
  status!: VendorStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
