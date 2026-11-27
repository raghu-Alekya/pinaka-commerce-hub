import type { DataSource } from 'typeorm';

export enum DeliveryChannel {
  DOORDASH = 'DOORDASH',
  UBER_EATS = 'UBER_EATS',
  SWIGGY = 'SWIGGY',
  ZOMATO = 'ZOMATO',
  INSTACART = 'INSTACART',
  SHOPIFY = 'SHOPIFY',
}

export class DeliveryChannelEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.delivery_channel_configs RESTRICT');
  }


  id!: string; // e.g. "CHAN-6001"

  merchantId!: string;

  storeId!: string;

  channel!: DeliveryChannel;

  externalStoreId!: string;

  webhookSecret?: string;

  autoAccept!: boolean;

  defaultPrepTimeMinutes!: number;

  isEnabled!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}
