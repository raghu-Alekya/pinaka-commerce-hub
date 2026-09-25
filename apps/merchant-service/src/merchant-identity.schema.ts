import { DataSource } from 'typeorm';

export async function ensureMerchantIdentitySchema(db: DataSource): Promise<void> {
  try {
    await db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');

      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantCode" varchar(100)');
      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantId" varchar(100)');

      await manager.query('UPDATE public.merchants SET "merchantId" = COALESCE("merchantId", "merchantCode", \'MER-\' || id::text) WHERE "merchantId" IS NULL');
      await manager.query('UPDATE public.merchants SET "merchantCode" = COALESCE("merchantCode", "merchantId", \'MER-\' || id::text) WHERE "merchantCode" IS NULL');

      try {
        await manager.query('CREATE INDEX IF NOT EXISTS merchants_identity_idx ON public.merchants("merchantId")');
      } catch {}
    });
  } catch (error) {
    console.warn('ensureMerchantIdentitySchema notice:', error);
  }
}
