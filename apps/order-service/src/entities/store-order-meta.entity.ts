import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('store_orders_meta')
@Index('store_orders_meta_order_key_uidx', ['orderId', 'metaKey'], { unique: true })
export class StoreOrderMetaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'meta_key', type: 'varchar', length: 191 })
  metaKey!: string;

  @Column({ name: 'meta_value', type: 'jsonb' })
  metaValue!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
