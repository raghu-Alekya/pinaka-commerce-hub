import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('order_line_items')
export class OrderItemEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  orderId!: string;

  @Column({ type: 'varchar', length: 100 })
  productId!: string;

  @Column({ type: 'varchar', length: 255 })
  productName!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  quantity!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice!: number;

  @Column({ type: 'jsonb', nullable: true })
  modifiers?: any[];
}
