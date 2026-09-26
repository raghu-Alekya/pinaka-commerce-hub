import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_service_charge_tiers')
@Index('pos_service_charge_tiers_parent_idx', ['serviceChargeId', 'sortOrder'])
export class PosServiceChargeTierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceChargeId!: string;

  @Column({ type: 'varchar', length: 50 })
  fromAmount!: string;

  @Column({ type: 'varchar', length: 50 })
  toAmount!: string;

  @Column({ type: 'varchar', length: 50 })
  fee!: string;

  @Column({ type: 'varchar', length: 32 })
  feeType!: string;

  @Column({ type: 'varchar', length: 32 })
  appliesTo!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
