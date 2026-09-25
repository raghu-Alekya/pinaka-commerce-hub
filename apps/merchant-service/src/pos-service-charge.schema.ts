import { DataSource } from 'typeorm';

/** One service-charge row per store, with tiers stored in their own table. */
export async function ensurePosServiceChargeSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 46)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_service_charge_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        "applyTo" varchar(32) NOT NULL DEFAULT 'order-total',
        "defaultType" varchar(32) NOT NULL DEFAULT 'percentage',
        "maxLimit" numeric(12,4) NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_service_charge_settings_store_uq UNIQUE ("storeId"),
        CONSTRAINT pos_service_charge_settings_apply_chk
          CHECK ("applyTo" IN ('order-total', 'line-item')),
        CONSTRAINT pos_service_charge_settings_type_chk
          CHECK ("defaultType" IN ('percentage', 'fixed')),
        CONSTRAINT pos_service_charge_settings_limit_chk
          CHECK ("maxLimit" >= 0)
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_service_charge_tiers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "serviceChargeId" uuid NOT NULL
          REFERENCES public.pos_service_charge_settings(id) ON DELETE CASCADE,
        "fromAmount" varchar(50) NOT NULL,
        "toAmount" varchar(50) NOT NULL,
        fee varchar(50) NOT NULL,
        "feeType" varchar(32) NOT NULL,
        "appliesTo" varchar(32) NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_service_charge_tiers_fee_type_chk
          CHECK ("feeType" IN ('Percentage', 'Fixed')),
        CONSTRAINT pos_service_charge_tiers_applies_chk
          CHECK ("appliesTo" IN ('Dine-In', 'Delivery', 'Takeaway', 'All')),
        CONSTRAINT pos_service_charge_tiers_from_chk CHECK (BTRIM("fromAmount") <> ''),
        CONSTRAINT pos_service_charge_tiers_to_chk CHECK (BTRIM("toAmount") <> ''),
        CONSTRAINT pos_service_charge_tiers_fee_chk CHECK (BTRIM(fee) <> '')
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_service_charge_tiers_parent_idx
      ON public.pos_service_charge_tiers ("serviceChargeId", "sortOrder")
    `);
  });
}
