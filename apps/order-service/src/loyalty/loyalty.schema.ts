import { DataSource, EntityManager } from 'typeorm';

export async function ensureLoyaltySchema(db: DataSource | EntityManager): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(724621, 84)').catch(() => undefined);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.store_customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id uuid NOT NULL,
      store_id uuid NOT NULL,
      name varchar(150) NOT NULL DEFAULT '',
      email varchar(255),
      mobile varchar(50),
      username varchar(150) NOT NULL,
      customer_role varchar(50) NOT NULL DEFAULT 'customer',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customers_store_role_idx
    ON public.store_customers (merchant_id, store_id, customer_role)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customers_store_email_idx
    ON public.store_customers (merchant_id, store_id, lower(email))
    WHERE customer_role = 'customer' AND email IS NOT NULL
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customers_store_mobile_idx
    ON public.store_customers (merchant_id, store_id, mobile)
    WHERE customer_role = 'customer' AND mobile IS NOT NULL
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS store_customers_store_username_uidx
    ON public.store_customers (merchant_id, store_id, username)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.store_customer_meta_data (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
      meta_key varchar(191) NOT NULL,
      meta_value jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT store_customer_meta_data_customer_key_uidx UNIQUE (customer_id, meta_key)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customer_meta_data_customer_idx
    ON public.store_customer_meta_data (customer_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customer_meta_data_key_idx
    ON public.store_customer_meta_data (meta_key)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.store_customer_loyalty_points (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL REFERENCES public.store_customers(id) ON DELETE CASCADE,
      merchant_id uuid NOT NULL,
      store_id uuid NOT NULL,
      contact varchar(191),
      order_id uuid,
      client_order_id varchar(150),
      credited_points numeric(12,2) NOT NULL DEFAULT 0,
      redeemed_points numeric(12,2) NOT NULL DEFAULT 0,
      expired_points numeric(12,2) NOT NULL DEFAULT 0,
      points_created_date timestamptz,
      points_expiry_date timestamptz,
      points_status varchar(20) NOT NULL DEFAULT 'active',
      source_refund_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customer_loyalty_points_customer_idx
    ON public.store_customer_loyalty_points (customer_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS store_customer_loyalty_points_order_idx
    ON public.store_customer_loyalty_points (merchant_id, store_id, order_id)
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS store_customer_loyalty_points_refund_uidx
    ON public.store_customer_loyalty_points (customer_id, order_id, source_refund_id)
    WHERE source_refund_id IS NOT NULL
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS store_customer_loyalty_points_credit_uidx
    ON public.store_customer_loyalty_points (customer_id, order_id)
    WHERE source_refund_id IS NULL AND credited_points > 0
  `);
}
