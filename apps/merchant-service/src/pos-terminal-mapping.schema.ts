import { DataSource } from 'typeorm';

/** One terminal-mapping configuration per store, with each register mapping in its own table. */
export async function ensurePosTerminalMappingSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 53)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_terminal_mapping_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_terminal_mapping_settings_store_uq UNIQUE ("storeId")
      )
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_terminal_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "mappingSettingsId" uuid NOT NULL
          REFERENCES public.pos_terminal_mapping_settings(id) ON DELETE CASCADE,
        "registerId" uuid NOT NULL,
        terminal varchar(100) NOT NULL DEFAULT '',
        printer varchar(100) NOT NULL DEFAULT '',
        drawer varchar(100) NOT NULL DEFAULT '',
        status varchar(20) NOT NULL DEFAULT 'Setup',
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_terminal_mappings_status_chk CHECK (status IN ('Active', 'Inactive', 'Setup'))
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS pos_terminal_mappings_parent_idx
      ON public.pos_terminal_mappings ("mappingSettingsId", "sortOrder")
    `);
  });
}
