import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_cashback_tiers')
@Index('pos_cashback_tiers_parent_idx', ['cashbackId', 'sortOrder'])
export class PosCashbackTierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cashbackId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  fromAmount!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  toAmount!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  fee!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
