import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum StoreStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PAUSED = 'PAUSED', // Busy / Kitchen pause mode
}

@Entity('merchants')
export class MerchantEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  merchantId!: string; // e.g. "STORE-01"

  @Column({ type: 'varchar', length: 255 })
  storeName!: string;

  @Column({ type: 'varchar', length: 50, default: StoreStatus.OPEN })
  status!: StoreStatus;

  @Column({ type: 'boolean', default: true })
  autoAcceptOrders!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  operatingHours!: {
    openTime: string; // e.g. "09:00"
    closeTime: string; // e.g. "22:00"
  };

  @Column({ type: 'jsonb', nullable: true })
  channels!: Array<{
    platform: string; // "DOORDASH", "SWIGGY", "UBER_EATS"
    externalStoreId: string;
    apiKey: string;
    enabled: boolean;
  }>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
