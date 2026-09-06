import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Stores only a hash of a refresh JWT, never the usable token itself. */
@Entity('refresh_tokens')
@Index(['userId', 'expiresAt'])
export class RefreshTokenEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 64, unique: true, select: false }) tokenHash!: string;
  @Column({ type: 'timestamp' }) expiresAt!: Date;
  @Column({ type: 'timestamp', nullable: true }) revokedAt?: Date | null;
  @Column({ type: 'uuid', nullable: true }) replacedById?: string | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
