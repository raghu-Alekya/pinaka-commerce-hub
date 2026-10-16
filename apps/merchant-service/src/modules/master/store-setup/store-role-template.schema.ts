import { DataSource } from 'typeorm';

/** Tenant mapping of role templates selected for a merchant store. */
export async function ensureStoreRoleTemplateSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 7)');
    await manager.query(`
      DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchants') THEN
          BEGIN
            ALTER TABLE public.merchants ADD CONSTRAINT uq_merchants_id UNIQUE (id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stores') THEN
          BEGIN
            ALTER TABLE public.stores ADD CONSTRAINT uq_stores_id UNIQUE (id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='role_templates') THEN
          BEGIN
            ALTER TABLE public.role_templates ADD CONSTRAINT uq_role_templates_id UNIQUE (id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END
      $migration$
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_role_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL,
        store_id uuid NOT NULL,
        role_template_id uuid NOT NULL,
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
  });
}
