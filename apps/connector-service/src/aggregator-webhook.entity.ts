import type { DataSource } from 'typeorm';

export type AggregatorWebhookStatus = 'RECEIVED' | 'SUCCESS' | 'FAILED';

export class AggregatorWebhookEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.aggregator_webhooks RESTRICT');
  }

  id!: string;

  payload!: Record<string, unknown>;

  storeId!: string | null;

  restaurantId!: string | null;

  status!: AggregatorWebhookStatus;

  errorMessage!: string | null;

  createdAt!: Date;

  updatedAt!: Date;
}
