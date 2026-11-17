import { DataSource } from 'typeorm';

/** Cash registers live in store_pos_configurations (cash_register_settings). */
export async function ensurePosCashRegisterSchema(_db: DataSource): Promise<void> {
  return;
}
