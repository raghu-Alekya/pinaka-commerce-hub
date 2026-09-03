import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

@Entity('promotions')
export class PromotionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "PROMO-9001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  promoCode!: string; // e.g. "WELCOME10", "SUMMER20"

  @Column({ type: 'varchar', length: 50, default: DiscountType.PERCENTAGE })
  discountType!: DiscountType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  discountValue!: number; // 10.00 for 10% or $10 off

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  minOrderAmount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxDiscountAmount?: number;

  @Column({ type: 'integer', default: 1000 })
  usageLimit!: number;

  @Column({ type: 'integer', default: 0 })
  usedCount!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
