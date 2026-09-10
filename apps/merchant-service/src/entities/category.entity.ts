import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('categories')
@Index(['storeId', 'wordpressId'], { unique: true })
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 100 }) storeId!: string;
  @Column({ type: 'int' }) wordpressId!: number;
  @Column({ type: 'int', default: 0 }) parentWordpressId!: number;
  @Column({ type: 'varchar', length: 255 }) name!: string;
  @Column({ type: 'varchar', length: 255, default: '' }) slug!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ type: 'int', default: 0 }) productCount!: number;
  @Column({ type: 'varchar', length: 2048, nullable: true }) image?: string | null;
  @Column({ type: 'varchar', length: 100, default: '' }) posTaxClass!: string;
  @Column({ type: 'varchar', length: 20, default: '' }) posTaxPercent!: string;
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
