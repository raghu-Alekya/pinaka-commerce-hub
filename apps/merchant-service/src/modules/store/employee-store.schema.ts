import { DataSource } from 'typeorm';

/** Store-employee assignment and the role mapped to that assignment. */
export async function ensureEmployeeStoreSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 52)');
    await manager.query(`
      DO $migration$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='employees') THEN
          BEGIN
            ALTER TABLE public.employees ADD CONSTRAINT uq_employees_id UNIQUE (id);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END
      $migration$
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.employee_stores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL,
        employee_id uuid NOT NULL,
        store_id uuid NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        login_pin_hash varchar(128),
        status varchar(30) NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_employee_store UNIQUE (employee_id, store_id)
      );
      CREATE INDEX IF NOT EXISTS idx_employee_stores_merchant_store
        ON public.employee_stores(merchant_id, store_id);
      CREATE INDEX IF NOT EXISTS idx_employee_stores_store
        ON public.employee_stores(store_id);

      CREATE TABLE IF NOT EXISTS public.employee_store_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL,
        store_id uuid NOT NULL,
        employee_store_id uuid NOT NULL,
        role_id uuid NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_employee_store_role UNIQUE (employee_store_id, role_id)
      );
      CREATE INDEX IF NOT EXISTS idx_employee_store_roles_store
        ON public.employee_store_roles(merchant_id, store_id);
      CREATE INDEX IF NOT EXISTS idx_employee_store_roles_role
        ON public.employee_store_roles(role_id);
    `);
  });
}
