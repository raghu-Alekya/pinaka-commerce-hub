import { DataSource } from 'typeorm';

/** One safe-and-drop row per store, with tube and drop denominations in their own tables. */
export async function ensurePosSafeDropSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 51)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_safe_drop_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        "primarySafe" varchar(100) NOT NULL DEFAULT '',
        "dropEnabled" boolean NOT NULL DEFAULT false,
        threshold numeric(12,2),
        minimum numeric(12,2),
        maximum numeric(12,2),
        "managerApproval" boolean NOT NULL DEFAULT true,
        "cashierInitiated" boolean NOT NULL DEFAULT true,
        "reasonRequired" boolean NOT NULL DEFAULT true,
        "tubeSize" integer,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_safe_drop_settings_store_uq UNIQUE ("storeId"),
        CONSTRAINT pos_safe_drop_settings_threshold_chk CHECK (threshold IS NULL OR threshold > 0),
        CONSTRAINT pos_safe_drop_settings_minimum_chk CHECK (minimum IS NULL OR minimum > 0),
        CONSTRAINT pos_safe_drop_settings_maximum_chk CHECK (maximum IS NULL OR maximum > 0),
        CONSTRAINT pos_safe_drop_settings_tube_chk CHECK ("tubeSize" IS NULL OR "tubeSize" > 0)
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_safe_drop_tubes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "safeDropId" uuid NOT NULL
          REFERENCES public.pos_safe_drop_settings(id) ON DELETE CASCADE,
        amount numeric(12,2) NOT NULL,
        quantity integer NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_safe_drop_tubes_amount_chk CHECK (amount > 0),
        CONSTRAINT pos_safe_drop_tubes_quantity_chk CHECK (quantity > 0)
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_safe_drop_denominations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "safeDropId" uuid NOT NULL
          REFERENCES public.pos_safe_drop_settings(id) ON DELETE CASCADE,
        amount numeric(12,2) NOT NULL,
        "imageName" varchar(255) NOT NULL,
        "imageData" text NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_safe_drop_denominations_amount_chk CHECK (amount > 0),
        CONSTRAINT pos_safe_drop_denominations_image_chk CHECK (BTRIM("imageData") <> '')
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_safe_drop_tubes_parent_idx
      ON public.pos_safe_drop_tubes ("safeDropId", "sortOrder")
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_safe_drop_denominations_parent_idx
      ON public.pos_safe_drop_denominations ("safeDropId", "sortOrder")
    `);
  });
}
