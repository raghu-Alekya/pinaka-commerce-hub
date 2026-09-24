import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('devices')
export class DeviceEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'varchar', length: 255 }) deviceName!: string;
  @Column({ type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 255 }) merchantName!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) storeId!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) storeName!: string | null;
  @Column({ type: 'varchar', length: 100, unique: true }) deviceCode!: string;
  @Column({ type: 'varchar', length: 100, unique: true }) serialNumber!: string;
  @Column({ type: 'varchar', length: 100 }) deviceType!: string;
  @Column({ type: 'varchar', length: 20, default: 'Active' }) status!: string;
  @Column({ type: 'jsonb' }) details!: Record<string, unknown>;
  @CreateDateColumn() createdAt!: Date;
}
