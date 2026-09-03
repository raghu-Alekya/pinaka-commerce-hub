import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

@Entity('customers')
export class CustomerEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "CUST-5001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'varchar', length: 50 })
  phone!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 50, default: LoyaltyTier.BRONZE })
  loyaltyTier!: LoyaltyTier;

  @Column({ type: 'integer', default: 0 })
  rewardPointsBalance!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalSpent!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
