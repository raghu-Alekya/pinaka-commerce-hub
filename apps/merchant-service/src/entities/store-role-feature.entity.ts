import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Audited, AuditColumns, RecordStatus } from './commerce-enums';
import { StoreEntity } from './store.entity';

/** Store-scoped role feature overrides. Role checks use feature_permissions; this table stays for that override. */
@Entity('store_role_features')
@Audited()
export class StoreRoleFeatureEntity extends AuditColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @ManyToOne(() => StoreEntity)
  @JoinColumn({ name: 'store_id' })
  store?: StoreEntity;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'features', type: 'jsonb', default: () => "'[]'" })
  features!: unknown[];

  @Column({
    name: 'status',
    type: 'enum',
    enum: RecordStatus,
    enumName: 'record_status',
    default: RecordStatus.ACTIVE,
  })
  status!: RecordStatus;
}
