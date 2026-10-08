import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type WebsiteConnectionStatus = 'CONNECTED' | 'NOT_CONNECTED';

@Entity('website_connections')
export class WebsiteConnectionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 }) storeId!: string;
  @Column({ type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 20, default: 'WORDPRESS' }) provider!: string;
  @Column({ type: 'varchar', length: 2048 }) wordpressUrl!: string;
  @Column({ type: 'text' }) encryptedJwt!: string;
  @Column({ type: 'varchar', length: 20, default: 'NOT_CONNECTED' })
  status!: WebsiteConnectionStatus;
  @Column({ type: 'timestamptz', nullable: true }) lastTestedAt?: Date | null;
  @Column({ type: 'text', nullable: true }) lastTestMessage?: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
