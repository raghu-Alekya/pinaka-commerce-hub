import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('menu_items')
export class MenuItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string; // e.g. "STORE-01"

  @Column({ type: 'varchar', length: 100 })
  externalItemId!: string; // e.g. "ITEM-101"

  @Column({ type: 'varchar', length: 255 })
  name!: string; // e.g. "Cheeseburger Deluxe"

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ type: 'varchar', length: 100, default: 'Mains' })
  category!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: number;

  @Column({ type: 'boolean', default: true })
  isAvailable!: boolean; // true = Available, false = 86'd / Sold out

  @Column({ type: 'jsonb', nullable: true })
  platformOverrides!: {
    doordashPrice?: number;
    swiggyPrice?: number;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
