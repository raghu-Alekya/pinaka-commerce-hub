import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_items')
export class InventoryItemEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "INV-7001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  productId!: string; // SKU / Barcode / PLU

  @Column({ type: 'varchar', length: 255 })
  productName!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  quantityOnHand!: number; // Physical count

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  quantityReserved!: number; // Reserved in active carts

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  quantityAvailable!: number; // Net sellable

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 10.00 })
  reorderPoint!: number; // Low stock threshold

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  unitCost!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  unitPrice!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
