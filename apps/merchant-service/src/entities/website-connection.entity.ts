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
  @PrimaryColumn({ name: 'store_id', type: 'varchar', length: 100 }) storeId!: string;
  @Column({ name: 'merchant_id', type: 'varchar', length: 100 }) merchantId!: string;
  @Column({ type: 'varchar', length: 20, default: 'WORDPRESS' }) provider!: string;
  @Column({ name: 'wordpress_url', type: 'varchar', length: 2048 }) wordpressUrl!: string;
  @Column({ name: 'encrypted_jwt', type: 'text' }) encryptedJwt!: string;
  @Column({ type: 'varchar', length: 20, default: 'NOT_CONNECTED' })
  status!: WebsiteConnectionStatus;
  @Column({ name: 'last_tested_at', type: 'timestamptz', nullable: true }) lastTestedAt?: Date | null;
  @Column({ name: 'last_test_message', type: 'text', nullable: true }) lastTestMessage?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
