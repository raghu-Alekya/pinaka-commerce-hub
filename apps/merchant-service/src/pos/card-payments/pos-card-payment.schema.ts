import { DataSource } from 'typeorm';

/** Card payment settings live in store_pos_configurations (card_payment_settings). */
export async function ensurePosCardPaymentSchema(_db: DataSource): Promise<void> {
  return;
}
