import { DataSource } from 'typeorm';

/**
 * Ensures master store_type_role_templates and tenant store_role_templates exist.
 * Safe to run on every merchant-service boot (CREATE IF NOT EXISTS).
 */
export async function ensureStoreRoleTemplateSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 7)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_type_role_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_type_id uuid NOT NULL REFERENCES public.store_types(id),
        role_template_id uuid NOT NULL REFERENCES public.role_templates(id),
        default_enabled boolean NOT NULL DEFAULT false,
        required boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_store_type_role_template UNIQUE (store_type_id, role_template_id)
      );
      CREATE INDEX IF NOT EXISTS idx_store_type_role_templates_store_type_id
        ON public.store_type_role_templates(store_type_id);
      CREATE INDEX IF NOT EXISTS idx_store_type_role_templates_role_template_id
        ON public.store_type_role_templates(role_template_id);
    `);

    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_role_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES public.merchants(id),
        store_id uuid NOT NULL,
        role_template_id uuid NOT NULL REFERENCES public.role_templates(id),
        enabled boolean NOT NULL DEFAULT true,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_store_role_template UNIQUE (merchant_id, store_id, role_template_id)
      );
      CREATE INDEX IF NOT EXISTS idx_store_role_templates_merchant_store
        ON public.store_role_templates(merchant_id, store_id);
      CREATE INDEX IF NOT EXISTS idx_store_role_templates_role_template
        ON public.store_role_templates(role_template_id);
    `);

    // Attach composite FK to stores(merchant_uuid, id) when that unique index exists.
    await manager.query(`
      DO $schema$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'stores_merchant_uuid_uq'
            OR conname = 'stores_merchant_uuid_id_key'
        ) OR EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'stores_merchant_uuid_uq'
        ) THEN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_role_templates_store_fk') THEN
            ALTER TABLE public.store_role_templates
              ADD CONSTRAINT store_role_templates_store_fk
              FOREIGN KEY (merchant_id, store_id)
              REFERENCES public.stores (merchant_uuid, id);
          END IF;
        END IF;
      END $schema$;
    `);
  });
}
