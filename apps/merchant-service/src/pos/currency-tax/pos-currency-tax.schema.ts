import { DataSource } from 'typeorm';

/** Currency and tax settings live in store_pos_configurations (currency_taxes). */
export async function ensurePosCurrencyTaxSchema(_db: DataSource): Promise<void> {
  return;
}
