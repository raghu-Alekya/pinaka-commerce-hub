import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('devices')
export class DeviceEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 100 }) storeId!: string;
  @Column({ type: 'varchar', length: 100, unique: true }) serialNumber!: string;
  @Column({ type: 'jsonb' }) details!: Record<string, unknown>;
  @CreateDateColumn() createdAt!: Date;
}
