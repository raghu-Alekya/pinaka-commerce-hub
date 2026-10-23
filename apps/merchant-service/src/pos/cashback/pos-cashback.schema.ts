import { DataSource } from 'typeorm';

/** Cashback settings live in store_pos_configurations (cashback_settings). */
export async function ensurePosCashbackSchema(_db: DataSource): Promise<void> {
  return;
}
