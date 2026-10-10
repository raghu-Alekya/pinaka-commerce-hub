import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('store_employee_fastkeys')
@Index(['storeId', 'employeeId'])
export class StoreEmployeeFastkeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'jsonb', default: '{}' })
  json!: {
    fastkey_title?: string;
    fastkey_index?: number;
    products?: Array<{ product_id: string; sl_number: number }>;
    [key: string]: unknown;
  };

  @Column({ name: 'fastkey_image', type: 'varchar', length: 2048, nullable: true })
  fastkeyImage?: string | null;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
