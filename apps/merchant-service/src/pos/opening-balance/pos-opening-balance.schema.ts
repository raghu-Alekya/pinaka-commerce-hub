import { DataSource } from 'typeorm';

/** Opening balance settings live in store_pos_configurations (opening_balance). */
export async function ensurePosOpeningBalanceSchema(_db: DataSource): Promise<void> {
  return;
}
