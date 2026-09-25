import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_safe_drop_denominations')
@Index('pos_safe_drop_denominations_parent_idx', ['safeDropId', 'sortOrder'])
export class PosSafeDropDenominationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  safeDropId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
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
