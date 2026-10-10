import { DataSource } from 'typeorm';

export async function ensureOnboardingSchema(db: DataSource): Promise<void> {
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "onboardingSetup" jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "storeCode" varchar(50)`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS store_email varchar(255)`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "Deleted_At" timestamptz`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "Is_Deleted" integer NOT NULL DEFAULT 0`);
  await db.query(`
    UPDATE public.stores
    SET "storeCode" = COALESCE(
      NULLIF(to_jsonb(stores)->>'storeCode', ''),
      NULLIF(to_jsonb(stores)->>'store_code', ''),
      'ST-' || SUBSTRING(REPLACE(COALESCE(to_jsonb(stores)->>'id', '000000'), '-', ''), 1, 6)
    )
    WHERE "storeCode" IS NULL OR "storeCode" = '';
  `);
}
