import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EmployeeEntity } from '../../entities/employee.entity';
import { StoreEntity } from '../../entities/store.entity';

export interface FastkeyJson {
  fastkey_title: string;
  fastkey_index: number;
  products?: Array<Record<string, unknown>>;
}

@Entity('store_employee_fastkeys')
@Index('idx_store_employee_fastkeys_scope', ['storeId', 'employeeId'])
export class StoreEmployeeFastkeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @ManyToOne(() => StoreEntity)
  @JoinColumn({ name: 'store_id', referencedColumnName: 'id' })
  store?: StoreEntity;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @ManyToOne(() => EmployeeEntity)
  @JoinColumn({ name: 'employee_id', referencedColumnName: 'id' })
  employee?: EmployeeEntity;

  @Column({ name: 'json', type: 'jsonb', default: () => "'{}'::jsonb" })
  json!: FastkeyJson;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'fastkey_image', type: 'text', default: '' })
  fastkeyImage!: string;
}
