import { DataSource, EntityManager } from 'typeorm';

type Queryable = Pick<DataSource | EntityManager, 'query'>;

async function columnExists(db: Queryable, table: string, column: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column]);
  return rows.length > 0;
}

async function tableExists(db: Queryable, table: string): Promise<boolean> {
  const rows = await db.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${table}`]);
  return Boolean(rows[0]?.present);
}

/**
 * Migrates the legacy merchant/subscription tables to the compact history schema.
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
      // Convert the original wide Merchant table and legacy Subscription table.
      if (await columnExists(runner.manager, 'merchants', 'merchant_code')) {
        await runner.query(`CREATE TABLE IF NOT EXISTS public.merchants_before_compact_20260922 AS TABLE public.merchants`);
        await runner.query(`CREATE TABLE IF NOT EXISTS public.subscriptions_before_compact_20260922 AS TABLE public.subscriptions`);
        await runner.query(`DO $compact$
          DECLARE item record;
          BEGIN
            FOR item IN SELECT column_name FROM information_schema.columns
              WHERE table_schema='public' AND table_name='merchants'
              AND column_name <> ALL (ARRAY[
                'merchant_code','merchantName','merchantEmail','merchantPhoneNumber','businessName','businessDisplayName',
                'storeType','initialStatus','addressLine1','addressLine2','city','state','pinCode','country','planId',
                'billingCycle','startDate','renewalDate','agreementPrice','roles','tax','totalDueToday','paymentMethod'
              ])
            LOOP EXECUTE format('ALTER TABLE public.merchants DROP COLUMN %I CASCADE',item.column_name); END LOOP;
          END $compact$`);
        await runner.query(`ALTER TABLE public.merchants RENAME COLUMN merchant_code TO merchant_id`);
        if (await columnExists(runner.manager, 'subscriptions', 'id')) {
          await runner.query(`ALTER TABLE public.subscriptions DROP COLUMN id CASCADE`);
        }
      }

      if (await columnExists(runner.manager, 'merchants', 'merchant_id')) {
        await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_merchant_fk`);
        await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey`);
        await runner.query(`ALTER TABLE public.merchants RENAME COLUMN merchant_id TO "merchantId"`);
        if (await columnExists(runner.manager, 'subscriptions', 'merchant_id')) {
          await runner.query(`ALTER TABLE public.subscriptions RENAME COLUMN merchant_id TO "merchantId"`);
        }
      }

      if (!(await columnExists(runner.manager, 'subscriptions', 'subscriptionId'))) {
        await runner.query(`ALTER TABLE public.subscriptions ADD COLUMN "subscriptionId" uuid NOT NULL DEFAULT gen_random_uuid()`);
      }
      if (await columnExists(runner.manager, 'merchants', 'storeType')) {
        await runner.query(`ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "storeTypeId_tmp" uuid`);
        await runner.query(`UPDATE public.merchants m SET "storeTypeId_tmp"=st.id FROM public.store_types st
          WHERE lower(st.name)=lower(m."storeType"::text) OR lower(st."storeTypeCode")=lower(m."storeType"::text)
             OR st.id::text=m."storeType"::text`);
        await runner.query(`ALTER TABLE public.merchants DROP COLUMN "storeType" CASCADE`);
        await runner.query(`ALTER TABLE public.merchants RENAME COLUMN "storeTypeId_tmp" TO "storeTypeId"`);
      }
      if (await columnExists(runner.manager, 'merchants', 'roles')) {
        await runner.query(`ALTER TABLE public.merchants RENAME COLUMN roles TO "roleIds"`);
      }

      await runner.query(`CREATE SEQUENCE IF NOT EXISTS public.merchant_id_seq`);
      await runner.query(`SELECT setval('public.merchant_id_seq',GREATEST(COALESCE((
        SELECT max(substring("merchantId" FROM '^MER-([0-9]+)$')::bigint) FROM public.merchants),0),1),true)`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN "merchantId" SET DEFAULT
        ('MER-' || lpad(nextval('public.merchant_id_seq')::text,6,'0'))`);

      await runner.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'ACTIVE'`);
      await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check`);
      await runner.query(`ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check CHECK(status IN ('ACTIVE','INACTIVE'))`);
      await runner.query(`DROP INDEX IF EXISTS public.subscriptions_merchant_uq`);
      await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_merchant_uq
        ON public.subscriptions("merchantId") WHERE status='ACTIVE'`);
      await runner.query(`CREATE INDEX IF NOT EXISTS subscriptions_merchant_idx ON public.subscriptions("merchantId")`);

      await runner.query(`CREATE TABLE IF NOT EXISTS public.merchant_identities(
        "merchantId" varchar(100) PRIMARY KEY,"createdDate" timestamptz NOT NULL DEFAULT now())`);
      await runner.query(`INSERT INTO public.merchant_identities("merchantId") SELECT DISTINCT "merchantId"
        FROM public.merchants ON CONFLICT("merchantId") DO NOTHING`);
      await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_merchant_fk`);

      if (!(await columnExists(runner.manager, 'merchants', 'id')) &&
          !(await columnExists(runner.manager, 'merchants', 'merchantRecordId'))) {
        await runner.query(`ALTER TABLE public.merchants ADD COLUMN "merchantRecordId" uuid NOT NULL DEFAULT gen_random_uuid()`);
      }
      await runner.query(`ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "createdDate" timestamptz NOT NULL DEFAULT now()`);
      await runner.query(`ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "updatedDate" timestamptz NOT NULL DEFAULT now()`);

      if (await columnExists(runner.manager, 'merchants', 'status')) {
        await runner.query(`UPDATE public.merchants SET "initialStatus"=status`);
        await runner.query(`ALTER TABLE public.merchants DROP COLUMN status CASCADE`);
      }
      await runner.query(`UPDATE public.merchants SET "initialStatus"='ACTIVE' WHERE "initialStatus" IS NULL`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN "initialStatus" SET DEFAULT 'ACTIVE'`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN "initialStatus" SET NOT NULL`);
      await runner.query(`ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_initial_status_check`);
      await runner.query(`ALTER TABLE public.merchants ADD CONSTRAINT merchants_initial_status_check
        CHECK("initialStatus" IN ('ACTIVE','INACTIVE'))`);

      if ((await columnExists(runner.manager, 'merchants', 'merchantRecordId')) &&
          !(await columnExists(runner.manager, 'merchants', 'id'))) {
        await runner.query(`ALTER TABLE public.merchants RENAME COLUMN "merchantRecordId" TO id`);
      }
      await runner.query(`ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid()`);
      await runner.query(`UPDATE public.merchants SET id=gen_random_uuid() WHERE id IS NULL`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN id SET NOT NULL`);

      await runner.query(`CREATE SEQUENCE IF NOT EXISTS public.merchant_code_seq`);
      await runner.query(`ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantCode" varchar(30)`);
      await runner.query(`UPDATE public.merchants SET "merchantCode"='MRC-'||lpad(nextval('public.merchant_code_seq')::text,8,'0')
        WHERE "merchantCode" IS NULL`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN "merchantCode" SET DEFAULT
        ('MRC-'||lpad(nextval('public.merchant_code_seq')::text,8,'0'))`);
      await runner.query(`ALTER TABLE public.merchants ALTER COLUMN "merchantCode" SET NOT NULL`);

      await runner.query(`CREATE SEQUENCE IF NOT EXISTS public.subscription_code_seq`);
      await runner.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS "subscriptionCode" varchar(30)`);
      await runner.query(`UPDATE public.subscriptions SET "subscriptionCode"='SUB-'||lpad(nextval('public.subscription_code_seq')::text,8,'0')
        WHERE "subscriptionCode" IS NULL`);
      await runner.query(`ALTER TABLE public.subscriptions ALTER COLUMN "subscriptionCode" SET DEFAULT
        ('SUB-'||lpad(nextval('public.subscription_code_seq')::text,8,'0'))`);
      await runner.query(`ALTER TABLE public.subscriptions ALTER COLUMN "subscriptionCode" SET NOT NULL`);

      await runner.query(`ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS "PK_4fd312ef25f8e05ad47bfe7ed25"`);
      await runner.query(`ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_pkey`);
      await runner.query(`ALTER TABLE public.merchants ADD CONSTRAINT merchants_pkey PRIMARY KEY(id)`);
      await runner.query(`ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_identity_fk`);
      await runner.query(`ALTER TABLE public.merchants ADD CONSTRAINT merchants_identity_fk FOREIGN KEY("merchantId")
        REFERENCES public.merchant_identities("merchantId") ON DELETE CASCADE`);
      await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey`);
      await runner.query(`ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey1`);
      await runner.query(`ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey1 PRIMARY KEY("subscriptionId")`);
      await runner.query(`ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_merchant_fk FOREIGN KEY("merchantId")
        REFERENCES public.merchant_identities("merchantId") ON DELETE CASCADE`);

      await runner.query(`DROP INDEX IF EXISTS public.merchants_one_active_id_uq`);
      await runner.query(`DROP INDEX IF EXISTS public.merchants_one_active_email_uq`);
      await runner.query(`CREATE UNIQUE INDEX merchants_one_active_id_uq ON public.merchants("merchantId")
        WHERE "initialStatus"='ACTIVE'`);
      await runner.query(`CREATE UNIQUE INDEX merchants_one_active_email_uq ON public.merchants(lower("merchantEmail"))
        WHERE "initialStatus"='ACTIVE'`);
      await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS merchants_row_id_uq ON public.merchants(id)`);
      await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS merchants_code_uq ON public.merchants("merchantCode")`);
      await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_code_uq ON public.subscriptions("subscriptionCode")`);
      await runner.query(`CREATE INDEX IF NOT EXISTS merchants_history_id_idx ON public.merchants("merchantId","createdDate" DESC)`);
      await runner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON public.subscriptions(plan_id)`);

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
