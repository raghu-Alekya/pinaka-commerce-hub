import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_safe_drop_settings')
@Index('pos_safe_drop_settings_store_uq', ['storeId'], { unique: true })
export class PosSafeDropEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 100, default: '' })
  primarySafe!: string;

  @Column({ type: 'boolean', default: false })
  dropEnabled!: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  threshold!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  minimum!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  maximum!: string | null;

  @Column({ type: 'boolean', default: true })
  managerApproval!: boolean;

  @Column({ type: 'boolean', default: true })
  cashierInitiated!: boolean;

  @Column({ type: 'boolean', default: true })
  reasonRequired!: boolean;

  @Column({ type: 'integer', nullable: true })
  tubeSize!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
