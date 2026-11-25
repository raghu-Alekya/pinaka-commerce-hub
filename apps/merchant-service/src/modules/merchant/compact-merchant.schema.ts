import { DataSource } from 'typeorm';

export async function ensureCompactMerchantSchema(db: DataSource): Promise<void> {
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(724621, 12)');
    await runner.startTransaction();
    try {
      await runner.query(`
        CREATE SEQUENCE IF NOT EXISTS public.merchant_id_seq START WITH 5001 INCREMENT BY 1;
        CREATE TABLE IF NOT EXISTS public.merchant_identities (
          "merchantId" varchar(100) PRIMARY KEY,
          created_at timestamptz DEFAULT now()
        );
      `);

      await runner.query(`
        CREATE TABLE IF NOT EXISTS public.merchants (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          merchant_code varchar(100),
          business_display_name varchar(255),
          created_at timestamptz DEFAULT now()
        );

        ALTER TABLE public.merchants
          ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS merchant_code varchar(100),
          ADD COLUMN IF NOT EXISTS "merchantName" varchar(255),
          ADD COLUMN IF NOT EXISTS "ownerName" varchar(255),
          ADD COLUMN IF NOT EXISTS name varchar(255),
          ADD COLUMN IF NOT EXISTS "merchantEmail" varchar(255),
          ADD COLUMN IF NOT EXISTS email varchar(255),
          ADD COLUMN IF NOT EXISTS "merchantPhoneNumber" varchar(100),
          ADD COLUMN IF NOT EXISTS phone varchar(100),
          ADD COLUMN IF NOT EXISTS business_display_name varchar(255),
          ADD COLUMN IF NOT EXISTS "legalBusinessName" varchar(255),
          ADD COLUMN IF NOT EXISTS "storeTypeId" uuid,
          ADD COLUMN IF NOT EXISTS address_line1 text,
          ADD COLUMN IF NOT EXISTS address_line2 text,
          ADD COLUMN IF NOT EXISTS "businessAddress" text,
          ADD COLUMN IF NOT EXISTS "city" varchar(100),
          ADD COLUMN IF NOT EXISTS "state" varchar(100),
          ADD COLUMN IF NOT EXISTS "pinCode" varchar(50),
          ADD COLUMN IF NOT EXISTS postal_code varchar(50),
          ADD COLUMN IF NOT EXISTS "country" varchar(100),
          ADD COLUMN IF NOT EXISTS "planId" uuid,
          ADD COLUMN IF NOT EXISTS "billingCycle" varchar(50) DEFAULT 'MONTHLY',
          ADD COLUMN IF NOT EXISTS "startDate" date,
          ADD COLUMN IF NOT EXISTS "renewalDate" date,
          ADD COLUMN IF NOT EXISTS "agreementPrice" numeric(10,2) DEFAULT 99.00,
          ADD COLUMN IF NOT EXISTS "roleIds" jsonb DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS "tax" numeric(10,2) DEFAULT 0.00,
          ADD COLUMN IF NOT EXISTS "totalDueToday" numeric(10,2) DEFAULT 99.00,
          ADD COLUMN IF NOT EXISTS "paymentMethod" varchar(50) DEFAULT 'CARD',
          ADD COLUMN IF NOT EXISTS status varchar(50) DEFAULT 'ACTIVE',
          ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

        UPDATE public.merchants SET id = gen_random_uuid() WHERE id IS NULL;
        UPDATE public.merchants SET status = COALESCE(status, 'ACTIVE') WHERE status IS NULL;
      `);

      await runner.query(`
        CREATE TABLE IF NOT EXISTS public.agent_merchants (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_user_id uuid NOT NULL,
          merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          created_by varchar(100),
          updated_by varchar(100),
          is_deleted boolean NOT NULL DEFAULT false,
          status varchar(20) NOT NULL DEFAULT 'ACTIVE',
          ended_at timestamptz,
          CONSTRAINT agent_merchants_agent_merchant_uq UNIQUE (agent_user_id, merchant_id)
        );
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'ACTIVE';
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS ended_at timestamptz;
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS created_by varchar(100);
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS updated_by varchar(100);
        ALTER TABLE public.agent_merchants ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS agent_merchants_agent_idx ON public.agent_merchants(agent_user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS agent_merchants_agent_merchant_uq ON public.agent_merchants(agent_user_id, merchant_id);
      `);
      const legacyAgentColumn = await runner.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants' AND column_name='agent_user_id'",
      );
      if (legacyAgentColumn.length) {
        await runner.query(`
          INSERT INTO public.agent_merchants (agent_user_id, merchant_id, status)
          SELECT agent_user_id, id, 'ACTIVE' FROM public.merchants WHERE agent_user_id IS NOT NULL
          ON CONFLICT (agent_user_id, merchant_id) DO NOTHING
        `);
        await runner.query('ALTER TABLE public.merchants DROP COLUMN agent_user_id');
      }

      await runner.query(`
        CREATE TABLE IF NOT EXISTS public.subscriptions (
          id varchar(100) PRIMARY KEY DEFAULT ('SUB-' || gen_random_uuid()::text),
          merchant_id varchar(100),
          subscription_code varchar(100),
          created_at timestamptz DEFAULT now()
        );

        ALTER TABLE public.subscriptions
          ADD COLUMN IF NOT EXISTS id varchar(100),
          ADD COLUMN IF NOT EXISTS merchant_id varchar(100),
          ADD COLUMN IF NOT EXISTS merchant_uuid uuid,
          ADD COLUMN IF NOT EXISTS subscription_code varchar(100),
          ADD COLUMN IF NOT EXISTS plan_id uuid,
          ADD COLUMN IF NOT EXISTS "planId" uuid,
          ADD COLUMN IF NOT EXISTS plan_code varchar(50) DEFAULT 'PRO',
          ADD COLUMN IF NOT EXISTS plan_name varchar(100) DEFAULT 'Pro Commerce Plan',
          ADD COLUMN IF NOT EXISTS "planName" varchar(100) DEFAULT 'Pro Commerce Plan',
          ADD COLUMN IF NOT EXISTS status varchar(50) DEFAULT 'ACTIVE',
          ADD COLUMN IF NOT EXISTS price numeric(10,2) DEFAULT 99.00,
          ADD COLUMN IF NOT EXISTS currency varchar(10) DEFAULT 'USD',
          ADD COLUMN IF NOT EXISTS billing_cycle varchar(20) DEFAULT 'MONTHLY',
          ADD COLUMN IF NOT EXISTS "billingCycle" varchar(20) DEFAULT 'MONTHLY',
          ADD COLUMN IF NOT EXISTS max_stores_allowed integer DEFAULT 3,
          ADD COLUMN IF NOT EXISTS licensed_store_count integer,
          ADD COLUMN IF NOT EXISTS licensed_device_count integer,
          ADD COLUMN IF NOT EXISTS entitlements jsonb DEFAULT '["POS","BARCODE_SCANNING","UBER_EATS","DOORDASH","PAYROLL","LOYALTY"]'::jsonb,
          ADD COLUMN IF NOT EXISTS auto_renew boolean DEFAULT true,
          ADD COLUMN IF NOT EXISTS current_period_start date DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS current_period_end date DEFAULT (CURRENT_DATE + interval '30 days'),
          ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

        UPDATE public.subscriptions SET id = subscription_code WHERE id IS NULL AND subscription_code IS NOT NULL;
        UPDATE public.subscriptions SET subscription_code = id WHERE subscription_code IS NULL AND id IS NOT NULL;
        UPDATE public.subscriptions SET "planId" = plan_id WHERE "planId" IS NULL AND plan_id IS NOT NULL;
        UPDATE public.subscriptions SET "billingCycle" = billing_cycle WHERE "billingCycle" IS NULL AND billing_cycle IS NOT NULL;
      `);

      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      console.warn('ensureCompactMerchantSchema notice:', e);
    } finally {
      await runner.query('SELECT pg_advisory_unlock(724621, 12)');
    }
  } finally {
    await runner.release();
  }
}
