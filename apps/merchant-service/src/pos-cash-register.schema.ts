import { DataSource } from 'typeorm';

/** One cash-register configuration per store, with each register in its own table. */
export async function ensurePosCashRegisterSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 50)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cash_register_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cash_register_settings_store_uq UNIQUE ("storeId")
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_cash_registers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "registerSettingsId" uuid NOT NULL
          REFERENCES public.pos_cash_register_settings(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        pos varchar(100) NOT NULL,
        "maxCash" numeric(12,2) NOT NULL,
        "safeDrop" boolean NOT NULL DEFAULT true,
        status varchar(20) NOT NULL DEFAULT 'Active',
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_cash_registers_status_chk CHECK (status IN ('Active', 'Inactive')),
        CONSTRAINT pos_cash_registers_cash_chk CHECK ("maxCash" > 0),
        CONSTRAINT pos_cash_registers_name_chk CHECK (BTRIM(name) <> ''),
        CONSTRAINT pos_cash_registers_pos_chk CHECK (BTRIM(pos) <> '')
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_cash_registers_parent_idx
      ON public.pos_cash_registers ("registerSettingsId", "sortOrder")
    `);
  });
}
