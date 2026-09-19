import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TendorStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}


@Entity('tendors')
@Index('tendors_name_active_uidx', ['tendorName'], {
  unique: true,
  where: `"deletedAt" IS NULL`,
})
@Index('tendors_code_active_uidx', ['tendorCode'], {
  unique: true,
  where: `"deletedAt" IS NULL AND "tendorCode" IS NOT NULL AND "tendorCode" <> ''`,
})
export class TendorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  tendorCode!: string;

  @Column({ type: 'varchar', length: 150 })
  tendorName!: string;

  @Column({ type: 'varchar', length: 20, default: TendorStatus.ACTIVE })
  status!: TendorStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
