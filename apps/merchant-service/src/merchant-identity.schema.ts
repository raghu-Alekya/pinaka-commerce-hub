import { DataSource } from 'typeorm';

export async function ensureMerchantIdentitySchema(db: DataSource): Promise<void> {
  try {
    await db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');
      const columns = new Set((await manager.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='merchants'`)).map((row: {column_name: string}) => row.column_name));

      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantCode" varchar(100)');
      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantId" varchar(100)');
      await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS merchant_code varchar(100)');

      if (columns.has('merchant_code')) {
        await manager.query('UPDATE public.merchants SET "merchantCode" = COALESCE("merchantCode", merchant_code) WHERE "merchantCode" IS NULL');
        await manager.query('UPDATE public.merchants SET "merchantId" = COALESCE("merchantId", merchant_code) WHERE "merchantId" IS NULL');
      }
      await manager.query('UPDATE public.merchants SET "merchantId" = COALESCE("merchantId", "merchantCode", merchant_code, \'MER-\' || id::text) WHERE "merchantId" IS NULL');
      await manager.query('UPDATE public.merchants SET "merchantCode" = COALESCE("merchantCode", "merchantId", merchant_code) WHERE "merchantCode" IS NULL');
      await manager.query('UPDATE public.merchants SET merchant_code = COALESCE(merchant_code, "merchantCode", "merchantId") WHERE merchant_code IS NULL');

      try {
        await manager.query('CREATE INDEX IF NOT EXISTS merchants_identity_idx ON public.merchants("merchantId")');
      } catch {}
    });
  } catch (error) {
    console.warn('ensureMerchantIdentitySchema notice:', error);
  }
}
