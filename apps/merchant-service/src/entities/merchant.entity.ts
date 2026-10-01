import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import { Audited, AuditColumns, MerchantStatus } from './commerce-enums';

export { MerchantStatus } from './commerce-enums';

export enum BusinessType {
  RETAIL = 'RETAIL',
  RESTAURANT = 'RESTAURANT',
}

export enum RetailSubCategory {
  GROCERY = 'GROCERY',
  CONVENIENCE = 'CONVENIENCE',
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

@Check('merchants_distinct_identity_code', `"merchant_code" <> "merchant_id"`)
@Entity('merchants')
@Audited()
export class MerchantEntity extends AuditColumns {
  @PrimaryColumn({ name: 'merchant_code', type: 'varchar', length: 100 })
  merchantCode!: string;

  @Column({ name: 'id', type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'merchant_id', type: 'varchar', length: 100, unique: true })
  merchantId!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName?: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName?: string | null;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'phone', type: 'varchar', length: 50 })
  phone!: string;

  @Column({ name: 'alternate_phone', type: 'varchar', length: 50, nullable: true })
  alternatePhone?: string | null;

  @Column({ name: 'tax_id', type: 'varchar', length: 100, nullable: true })
  taxId?: string | null;

  @Column({ name: 'onboarding_step', type: 'varchar', length: 50, default: 'STEP1_BUSINESS' })
  onboardingStep!: string;

  @Column({ name: 'business_display_name', type: 'varchar', length: 255, nullable: true })
  businessDisplayName?: string | null;

  get businessName(): string | null | undefined {
    return this.businessDisplayName;
  }

  set businessName(value: string | null | undefined) {
    if (value !== undefined) this.businessDisplayName = value;
  }

  @Column({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode?: string | null;

  @Column({ name: 'state', type: 'varchar', length: 100, nullable: true })
  state?: string | null;

  @Column({ name: 'city', type: 'varchar', length: 100, nullable: true })
  city?: string | null;

  @Column({ name: 'country', type: 'varchar', length: 100, nullable: true })
  country?: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: MerchantStatus,
    enumName: 'merchant_status',
    default: MerchantStatus.ACTIVE,
  })
  status!: MerchantStatus;
}
