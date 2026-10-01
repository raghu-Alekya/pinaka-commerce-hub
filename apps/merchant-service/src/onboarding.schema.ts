import { DataSource } from 'typeorm';

export async function ensureOnboardingSchema(db: DataSource): Promise<void> {
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "onboardingSetup" jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "storeCode" varchar(50)`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS store_email varchar(255)`);
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS status varchar(50) NOT NULL DEFAULT 'ACTIVE'`);
  await db.query(`
    UPDATE public.stores
    SET status = COALESCE(NULLIF(UPPER(BTRIM(status)), ''), 'ACTIVE')
    WHERE status IS NULL OR status <> COALESCE(NULLIF(UPPER(BTRIM(status)), ''), 'ACTIVE');
  `);
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name='Is_Deleted') THEN
        EXECUTE 'UPDATE public.stores SET status = ''INACTIVE'' WHERE COALESCE("Is_Deleted", 0) <> 0';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name='Deleted_At') THEN
        EXECUTE 'UPDATE public.stores SET status = ''INACTIVE'' WHERE "Deleted_At" IS NOT NULL';
      END IF;
    END $$;
  `);
  await db.query(`ALTER TABLE public.stores DROP COLUMN IF EXISTS "Deleted_At"`);
  await db.query(`ALTER TABLE public.stores DROP COLUMN IF EXISTS "Is_Deleted"`);
  await db.query(`
    UPDATE public.stores
    SET "storeCode" = COALESCE(
      NULLIF(to_jsonb(stores)->>'storeCode', ''),
      NULLIF(to_jsonb(stores)->>'store_code', ''),
      NULLIF(to_jsonb(stores)->>'legacy_store_id', ''),
      'ST-' || SUBSTRING(REPLACE(COALESCE(to_jsonb(stores)->>'id', '000000'), '-', ''), 1, 6)
    )
    WHERE "storeCode" IS NULL OR "storeCode" = '';
  `);
}
