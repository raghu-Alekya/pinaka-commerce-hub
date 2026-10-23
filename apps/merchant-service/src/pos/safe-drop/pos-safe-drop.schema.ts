import { DataSource } from 'typeorm';

/** Safe-drop settings live in store_pos_configurations (safe_and_safe_drop). */
export async function ensurePosSafeDropSchema(_db: DataSource): Promise<void> {
  return;
}
