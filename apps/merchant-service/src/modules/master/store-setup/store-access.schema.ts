import { DataSource } from 'typeorm';

/** Store feature selections and per-role permission matrix from the store wizard. */
export async function ensureStoreAccessSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 51)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_features (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_uuid uuid NOT NULL,
        store_id uuid NOT NULL,
        legacy_store_id varchar(100) NOT NULL,
        feature_id uuid,
        feature_name varchar(255) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_store_features_store_name UNIQUE (store_id, feature_name)
      )
    `);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_features_store_idx ON public.store_features (store_id)`);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_features_merchant_idx ON public.store_features (merchant_uuid)`);

    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_roles_permission (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_uuid uuid NOT NULL,
        store_id uuid NOT NULL,
        legacy_store_id varchar(100) NOT NULL,
        role_template_id uuid,
        role_name varchar(255) NOT NULL,
        feature_name varchar(255) NOT NULL,
        permission_action varchar(20) NOT NULL,
        allowed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_store_roles_permission UNIQUE (store_id, role_name, feature_name, permission_action)
      )
    `);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_roles_permission_store_idx ON public.store_roles_permission (store_id)`);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_roles_permission_role_idx ON public.store_roles_permission (store_id, role_template_id)`);
  });
}
