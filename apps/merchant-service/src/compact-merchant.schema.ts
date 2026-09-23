import { DataSource } from 'typeorm';

async function tableExists(db: DataSource, table: string): Promise<boolean> {
  const rows = await db.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${table}`]);
  return Boolean(rows[0]?.present);
}

/**
 * Ensures safe, additive connectivity between the merchants table and subscriptions table.
 * 100% Non-destructive: No columns are dropped or renamed.
 * The advisory lock makes this safe when multiple local services start together.
 */
export async function ensureCompactMerchantSchema(db: DataSource): Promise<void> {
  if (!(await tableExists(db, 'merchants')) || !(await tableExists(db, 'subscriptions'))) return;

  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(724621, 12)');
    await runner.startTransaction();
    try {
      // 1. Ensure additive relationship columns on public.merchants
      await runner.query(`
        ALTER TABLE public.merchants
          ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS merchant_code varchar(100),
          ADD COLUMN IF NOT EXISTS status varchar(50) DEFAULT 'ACTIVE',
          ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

        UPDATE public.merchants SET id = gen_random_uuid() WHERE id IS NULL;
        ALTER TABLE public.merchants ALTER COLUMN id SET DEFAULT gen_random_uuid();
      `);

      // 2. Ensure additive relationship columns on public.subscriptions
      await runner.query(`
        ALTER TABLE public.subscriptions
          ADD COLUMN IF NOT EXISTS id varchar(100),
          ADD COLUMN IF NOT EXISTS merchant_id varchar(100),
          ADD COLUMN IF NOT EXISTS merchant_uuid uuid,
          ADD COLUMN IF NOT EXISTS subscription_code varchar(100),
          ADD COLUMN IF NOT EXISTS plan_id uuid,
          ADD COLUMN IF NOT EXISTS plan_code varchar(50) DEFAULT 'PRO',
          ADD COLUMN IF NOT EXISTS plan_name varchar(100) DEFAULT 'Pro Commerce Plan',
          ADD COLUMN IF NOT EXISTS status varchar(50) DEFAULT 'ACTIVE',
          ADD COLUMN IF NOT EXISTS price numeric(10,2) DEFAULT 99.00,
          ADD COLUMN IF NOT EXISTS currency varchar(10) DEFAULT 'USD',
          ADD COLUMN IF NOT EXISTS billing_cycle varchar(20) DEFAULT 'MONTHLY',
          ADD COLUMN IF NOT EXISTS max_stores_allowed integer DEFAULT 3,
          ADD COLUMN IF NOT EXISTS licensed_store_count integer,
          ADD COLUMN IF NOT EXISTS licensed_device_count integer,
          ADD COLUMN IF NOT EXISTS entitlements jsonb DEFAULT '["POS","BARCODE_SCANNING","UBER_EATS","DOORDASH","PAYROLL","LOYALTY"]'::jsonb,
          ADD COLUMN IF NOT EXISTS start_date date,
          ADD COLUMN IF NOT EXISTS renewal_date date,
          ADD COLUMN IF NOT EXISTS trial_end_date date,
          ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
      `);

      // 3. Backfill relationship between merchants and subscriptions
      await runner.query(`
        -- Backfill merchant_uuid on subscriptions from merchants matching merchant_code or id
        UPDATE public.subscriptions s
        SET merchant_uuid = m.id
        FROM public.merchants m
        WHERE s.merchant_uuid IS NULL
          AND (
            COALESCE(to_jsonb(s)->>'merchant_id', to_jsonb(s)->>'merchantId') = m.merchant_code::text
            OR COALESCE(to_jsonb(s)->>'merchant_id', to_jsonb(s)->>'merchantId') = m.id::text
          );

        -- Backfill merchant_id string on subscriptions from merchants if missing
        UPDATE public.subscriptions s
        SET merchant_id = COALESCE(NULLIF(m.merchant_code, ''), m.id::text)
        FROM public.merchants m
        WHERE (s.merchant_id IS NULL OR s.merchant_id = '')
          AND s.merchant_uuid = m.id;
      `);

      // 4. Safe foreign key constraints (only added if all rows satisfy the constraint)
      await runner.query(`
        DO $fk$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_merchant_uuid_fk')
             AND NOT EXISTS (
               SELECT 1 FROM public.subscriptions s
               WHERE s.merchant_uuid IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = s.merchant_uuid)
             ) THEN
            ALTER TABLE public.subscriptions
              ADD CONSTRAINT subscriptions_merchant_uuid_fk
              FOREIGN KEY (merchant_uuid) REFERENCES public.merchants(id);
          END IF;
        END $fk$;
      `);

      // 5. Safe performance indexes
      await runner.query(`
        CREATE INDEX IF NOT EXISTS subscriptions_merchant_id_idx ON public.subscriptions(merchant_id);
        CREATE INDEX IF NOT EXISTS subscriptions_merchant_uuid_idx ON public.subscriptions(merchant_uuid);
        CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions(status);
        CREATE INDEX IF NOT EXISTS subscriptions_plan_id_idx ON public.subscriptions(plan_id);
        CREATE INDEX IF NOT EXISTS subscriptions_created_at_idx ON public.subscriptions(created_at DESC);
      `);

      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  } finally {
    await runner.query('SELECT pg_advisory_unlock(724621, 12)').catch(() => undefined);
    await runner.release();
  }
}
