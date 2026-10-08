import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns } from './commerce-enums';

@Entity('store_categories')
@Audited()
@Index(['storeId'], { unique: true })
export class CategoryEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'[]'" })
  payload!: unknown[];
}
