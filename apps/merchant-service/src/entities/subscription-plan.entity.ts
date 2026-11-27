import type { DataSource } from 'typeorm';

export class SubscriptionPlanEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.subscription_plans RESTRICT');
  }
}
