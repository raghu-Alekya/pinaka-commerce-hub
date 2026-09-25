import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_cash_denomination_items')
@Index('pos_cash_denomination_items_parent_idx', ['denominationId', 'kind', 'sortOrder'])
export class PosCashDenominationItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  denominationId!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  amount!: string;

  @Column({ type: 'varchar', length: 255 })
  imageName!: string;

  @Column({ type: 'text' })
  imageData!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
