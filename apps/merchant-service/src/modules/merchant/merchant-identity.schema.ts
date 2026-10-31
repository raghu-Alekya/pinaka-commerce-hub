import { DataSource } from 'typeorm';

export async function ensureMerchantIdentitySchema(db: DataSource): Promise<void> {
  try {
    await db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');

      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS merchant_code varchar(100)');
      await manager.query(`ALTER TABLE public.merchants DROP COLUMN IF EXISTS merchant_id`);
    });
  } catch (error) {
    console.warn('ensureMerchantIdentitySchema notice:', error);
  }
}
