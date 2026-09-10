import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('products')
@Index(['storeId', 'wordpressId', 'wordpressCategoryId'], { unique: true })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 100 }) storeId!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'int' }) wordpressId!: number;
  @Column({ type: 'int' }) wordpressCategoryId!: number;
  @Column({ type: 'varchar', length: 255 }) name!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) price?: string | null;
  @Column({ type: 'varchar', length: 2048, nullable: true }) image?: string | null;
  @Column({ type: 'jsonb', default: [] }) tags!: unknown[];
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
