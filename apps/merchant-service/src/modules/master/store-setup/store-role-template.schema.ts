import { DataSource } from 'typeorm';

/** Tenant mapping of role templates selected for a merchant store. */
export async function ensureStoreRoleTemplateSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 7)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_role_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES public.merchants(id),
        store_id uuid NOT NULL REFERENCES public.stores(id),
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
  });
}
