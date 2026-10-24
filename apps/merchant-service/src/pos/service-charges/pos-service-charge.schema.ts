import { DataSource } from 'typeorm';

/** Service charges live in store_pos_configurations (service_charges). */
export async function ensurePosServiceChargeSchema(_db: DataSource): Promise<void> {
  return;
}
