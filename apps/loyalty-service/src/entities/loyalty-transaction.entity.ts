import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum PointTransactionType {
  EARNED = 'EARNED',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  BONUS = 'BONUS',
}

@Entity('loyalty_point_transactions')
export class LoyaltyTransactionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  customerId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  orderId?: string;

  @Column({ type: 'varchar', length: 50, default: PointTransactionType.EARNED })
  transactionType!: PointTransactionType;

  @Column({ type: 'integer' })
  points!: number; // +100 or -50

  @Column({ type: 'integer' })
  newBalance!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
