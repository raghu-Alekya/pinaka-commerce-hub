import { DataSource } from 'typeorm';

/** One currency-and-tax row per store, with tax classes stored in their own table. */
export async function ensurePosCurrencyTaxSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 45)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_currency_tax_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        currency varchar(3) NOT NULL,
        rounding varchar(32) NOT NULL DEFAULT 'nearest-cent',
        "decimalPlaces" smallint NOT NULL DEFAULT 2,
        "taxEnabled" boolean NOT NULL DEFAULT true,
        "defaultTaxRate" numeric(8,4),
        "taxCalculation" varchar(32) NOT NULL DEFAULT 'item-price',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_currency_tax_settings_store_uq UNIQUE ("storeId"),
        CONSTRAINT pos_currency_tax_settings_rounding_chk
          CHECK (rounding IN ('nearest-cent', 'nearest-dollar', 'down', 'up')),
        CONSTRAINT pos_currency_tax_settings_decimals_chk
          CHECK ("decimalPlaces" BETWEEN 0 AND 4),
        CONSTRAINT pos_currency_tax_settings_calculation_chk
          CHECK ("taxCalculation" IN ('item-price', 'subtotal', 'total')),
        CONSTRAINT pos_currency_tax_settings_rate_chk
          CHECK ("defaultTaxRate" IS NULL OR "defaultTaxRate" >= 0)
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_tax_classes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "currencyTaxId" uuid NOT NULL
          REFERENCES public.pos_currency_tax_settings(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL,
        rate numeric(8,4) NOT NULL DEFAULT 0,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_tax_classes_rate_chk CHECK (rate >= 0),
        CONSTRAINT pos_tax_classes_name_chk CHECK (BTRIM(name) <> '')
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_tax_classes_parent_idx
      ON public.pos_tax_classes ("currencyTaxId", "sortOrder")
    `);
  });
}
