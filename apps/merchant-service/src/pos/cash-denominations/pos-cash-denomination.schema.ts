import { DataSource } from 'typeorm';

/** Cash denominations live in store_pos_configurations (cash_denominations). */
export async function ensurePosCashDenominationSchema(_db: DataSource): Promise<void> {
  return;
}
