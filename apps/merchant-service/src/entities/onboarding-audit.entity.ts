import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('onboarding_audit_logs')
export class OnboardingAuditEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  storeId?: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string; // 'MERCHANT_REGISTERED', 'STORE_CREATED', 'PIN_GENERATED', 'KYC_UPLOADED', 'ONBOARDING_COMPLETED'

  @Column({ type: 'varchar', length: 255 })
  performedBy!: string;

  @Column({ type: 'jsonb', default: {} })
  details!: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}
