import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pos_terminal_mappings')
@Index('pos_terminal_mappings_parent_idx', ['mappingSettingsId', 'sortOrder'])
export class PosTerminalMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  mappingSettingsId!: string;

  @Column({ type: 'uuid' })
  registerId!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  terminal!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  printer!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  drawer!: string;

  @Column({ type: 'varchar', length: 20, default: 'Setup' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
