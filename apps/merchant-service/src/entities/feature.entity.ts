import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum FeatureStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('features')
export class FeatureEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'feature_key', type: 'varchar', length: 100, unique: true })
  featureKey!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Column({ name: 'feature_type', type: 'varchar', length: 20, default: 'TEXT' })
  featureType!: string;

  @Column({ type: 'varchar', length: 20, default: FeatureStatus.ACTIVE })
  status!: FeatureStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
