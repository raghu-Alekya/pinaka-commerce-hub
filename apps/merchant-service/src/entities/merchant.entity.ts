import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum BusinessType {
  RETAIL = 'RETAIL',
  RESTAURANT = 'RESTAURANT',
}

export enum RetailSubCategory {
  GROCERY = 'GROCERY',
  CONVENIENCE = 'CONVENIENCE',
}

export enum MerchantStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export enum KycStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export interface KycDocument {
  docType: 'BUSINESS_LICENSE' | 'OWNER_ID' | 'TAX_CERTIFICATE';
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  status: KycStatus;
  uploadedAt: string;
}

@Entity('merchants')
export class MerchantEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "MCH-1001"

  @Column({ type: 'varchar', length: 255 })
  businessName!: string;

  // Fields captured by the merchant onboarding form.
  @Column({ type: 'varchar', length: 255, nullable: true })
  legalBusinessName?: string;

  @Column({ type: 'varchar', length: 50, default: BusinessType.RETAIL })
  businessType!: BusinessType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  retailSubCategory?: RetailSubCategory;

  @Column({ type: 'varchar', length: 150 })
  ownerName!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 50 })
  phone!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taxId?: string; // EIN / GST

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  postalCode?: string;

  @Column({ type: 'text', nullable: true })
  businessAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  jobTitle?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  alternatePhone?: string;

  @Column({ type: 'boolean', default: true })
  billingContact!: boolean;

  @Column({ type: 'varchar', length: 50, default: KycStatus.PENDING })
  kycStatus!: KycStatus;

  @Column({ type: 'jsonb', default: [] })
  kycDocuments!: KycDocument[];

  @Column({ type: 'varchar', length: 50, default: MerchantStatus.PENDING })
  status!: MerchantStatus;

  @Column({ type: 'varchar', length: 50, default: 'STEP1_BUSINESS' })
  onboardingStep!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
