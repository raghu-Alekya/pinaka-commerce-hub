import type { DataSource } from 'typeorm';

export class WooCommerceConnectionEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.woocommerce_connections RESTRICT');
  }
}
