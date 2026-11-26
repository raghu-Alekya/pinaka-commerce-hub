import type { DataSource } from 'typeorm';

// The retired accounts table must stay outside TypeORM's entity metadata.
export class AccountEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.accounts RESTRICT');
  }
}
