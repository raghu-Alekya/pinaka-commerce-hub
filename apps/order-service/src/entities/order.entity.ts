import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum OrderType {
  IN_STORE_POS = 'IN_STORE_POS',
  ONLINE_DELIVERY = 'ONLINE_DELIVERY',
  ONLINE_WEB = 'ONLINE_WEB',
  DINE_IN = 'DINE_IN',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  STORE_CREDIT = 'STORE_CREDIT',
}

export enum PaymentStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
}

export enum OrderStatus {
  CREATED = 'CREATED',
  CONFIRMED = 'CONFIRMED',
  IN_PREPARATION = 'IN_PREPARATION',
  READY_FOR_DISPATCH = 'READY_FOR_DISPATCH',
  DISPATCHED = 'DISPATCHED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('orders')
export class OrderEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "ORD-10045"

  @Column({ type: 'varchar', length: 100 })
  orderNumber!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  shiftId?: string;

  @Column({ type: 'varchar', length: 150, default: 'Walk-in Customer' })
  customerName!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customerPhone?: string;

  @Column({ type: 'varchar', length: 50, default: OrderType.IN_STORE_POS })
  orderType!: OrderType;

  @Column({ type: 'varchar', length: 50, default: PaymentMethod.CASH })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', length: 50, default: PaymentStatus.PAID })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  taxAmount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  discountAmount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  tipAmount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount!: number;

  @Column({ type: 'varchar', length: 50, default: OrderStatus.CREATED })
  orderStatus!: OrderStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
