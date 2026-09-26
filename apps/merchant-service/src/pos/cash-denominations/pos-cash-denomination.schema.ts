import { DataSource } from 'typeorm';

/** One cash-denomination row per store, with cash and coin items in their own table. */
export async function ensurePosCashDenominationSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 49)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cash_denomination_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cash_denomination_settings_store_uq UNIQUE ("storeId")
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cash_denomination_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "denominationId" uuid NOT NULL
          REFERENCES public.pos_cash_denomination_settings(id) ON DELETE CASCADE,
        kind varchar(10) NOT NULL,
        amount numeric(12,4) NOT NULL,
        "imageName" varchar(255) NOT NULL,
        "imageData" text NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cash_denomination_items_kind_chk CHECK (kind IN ('cash', 'coin')),
        CONSTRAINT pos_cash_denomination_items_amount_chk CHECK (amount > 0),
        CONSTRAINT pos_cash_denomination_items_image_chk CHECK (BTRIM("imageData") <> '')
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_cash_denomination_items_parent_idx
      ON public.pos_cash_denomination_items ("denominationId", kind, "sortOrder")
    `);
  });
}
