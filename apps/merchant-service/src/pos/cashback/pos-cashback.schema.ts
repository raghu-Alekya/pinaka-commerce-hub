import { DataSource } from 'typeorm';

/** One cashback row per store, with fee tiers stored in their own table. */
export async function ensurePosCashbackSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 47)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cashback_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        "maxCashback" numeric(12,4),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cashback_settings_store_uq UNIQUE ("storeId"),
        CONSTRAINT pos_cashback_settings_limit_chk
          CHECK ("maxCashback" IS NULL OR "maxCashback" >= 0)
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cashback_tiers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cashbackId" uuid NOT NULL
          REFERENCES public.pos_cashback_settings(id) ON DELETE CASCADE,
        "fromAmount" numeric(12,4) NOT NULL,
        "toAmount" numeric(12,4) NOT NULL,
        fee numeric(12,4) NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cashback_tiers_from_chk CHECK ("fromAmount" >= 0),
        CONSTRAINT pos_cashback_tiers_to_chk CHECK ("toAmount" >= 0),
        CONSTRAINT pos_cashback_tiers_fee_chk CHECK (fee >= 0)
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_cashback_tiers_parent_idx
      ON public.pos_cashback_tiers ("cashbackId", "sortOrder")
    `);
  });
}
