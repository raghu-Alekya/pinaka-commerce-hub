import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum DeliveryOrderStatus {
  RECEIVED = 'RECEIVED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

@Entity('delivery_order_logs')
export class DeliveryOrderLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "DEL-10045"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50 })
  channel!: string; // 'DOORDASH' | 'UBER_EATS' | 'SWIGGY'

  @Column({ type: 'varchar', length: 100 })
  externalOrderId!: string;

  @Column({ type: 'varchar', length: 150 })
  customerName!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customerPhone?: string;

  @Column({ type: 'jsonb' })
  deliveryAddress!: Record<string, any>;

  @Column({ type: 'varchar', length: 150, nullable: true })
  driverName?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  driverPhone?: string;

  @Column({ type: 'integer', default: 20 })
  prepTimeMinutes!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 3.99 })
  deliveryFee!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalAmount!: number;

  @Column({ type: 'jsonb' })
  orderItems!: any[];

  @Column({ type: 'varchar', length: 50, default: DeliveryOrderStatus.RECEIVED })
  status!: DeliveryOrderStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
