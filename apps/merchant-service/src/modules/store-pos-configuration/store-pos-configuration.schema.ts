import { DataSource } from 'typeorm';

/** Named JSON POS settings for one store. */
export async function ensureStorePosConfigurationSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 53)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_pos_configurations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id uuid NOT NULL,
        configuration_name varchar(100) NOT NULL,
        configuration_value jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid,
        updated_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await manager.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_pos_configuration_store_name
      ON public.store_pos_configurations (store_id, configuration_name)
    `);
    // ON CONFLICT (...) requires a UNIQUE/PRIMARY KEY constraint, not only
    // a unique index. Older local databases may have the index but not the
    // constraint, which causes currency/tax updates to fail with 42P10.
    await manager.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.store_pos_configurations'::regclass
             AND conname = 'store_pos_configurations_store_name_key'
        ) THEN
          ALTER TABLE public.store_pos_configurations
            ADD CONSTRAINT store_pos_configurations_store_name_key
            UNIQUE (store_id, configuration_name);
        END IF;
      END $$;
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS idx_store_pos_configurations_store_id
      ON public.store_pos_configurations (store_id)
    `);
  });
}
