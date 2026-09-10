import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sessions')
@Index(['userId', 'expiresAt'])
export class SessionEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'uuid', nullable: true }) accountId?: string | null;
  @Column({ type: 'varchar', length: 255 }) email!: string;
  @Column({ type: 'varchar', length: 20 }) role!: string;
  @Column({ type: 'varchar', length: 64, unique: true, select: false })
  accessTokenHash!: string;
  @Column({ type: 'uuid', nullable: true }) refreshTokenId?: string | null;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) lastUsedAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt?: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
