import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('menu_sync_logs')
export class MenuSyncAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'integer' })
  synchronizedItems!: number;

  @Column({ type: 'varchar', length: 100 })
  status!: string; // "MENU_SYNCHRONIZED_TO_ALL_PLATFORMS"

  @Column({ type: 'jsonb', nullable: true })
  platforms!: string[]; // ["DOORDASH", "SWIGGY"]

  @CreateDateColumn()
  syncedAt!: Date;
}
