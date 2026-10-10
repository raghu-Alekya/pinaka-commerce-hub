import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { RecordStatus } from './commerce-enums';

export { RecordStatus as StoreTypeStatus } from './commerce-enums';

@Entity('store_types')
export class StoreTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'store_type_code',
    type: 'varchar',
    length: 50,
    unique: true,
  })
  storeTypeCode!: string;

  get code(): string {
    return this.storeTypeCode;
  }

  set code(value: string) {
    if (value) this.storeTypeCode = value;
  }

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'is_deleted', type: 'boolean', default: false, nullable: true })
  isDeleted?: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;
}
