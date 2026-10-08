import { DataSource } from 'typeorm';

/** One row per employee assignment. Existing installs used employee_stores. */
export async function renameEmployeeStoresTable(db: DataSource): Promise<void> {
  await db.query(`
    DO $$
    DECLARE
      old_table oid;
      new_table oid;
      new_empty boolean;
    BEGIN
      old_table := to_regclass('public.employee_stores');
      new_table := to_regclass('public.store_employees');
      IF old_table IS NOT NULL AND new_table IS NOT NULL THEN
        EXECUTE 'SELECT NOT EXISTS (SELECT 1 FROM public.store_employees LIMIT 1)' INTO new_empty;
        IF new_empty THEN
          EXECUTE 'DROP TABLE public.store_employees';
          new_table := NULL;
        END IF;
      END IF;
      IF old_table IS NOT NULL AND new_table IS NULL THEN
        EXECUTE 'ALTER TABLE public.employee_stores RENAME TO store_employees';
      END IF;
    END $$;
  `);
}

/** Store-employee assignment and the role mapped to that assignment. */
export async function ensureEmployeeStoreSchema(db: DataSource): Promise<void> {
  await renameEmployeeStoresTable(db);
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 52)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_employees (
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
      CREATE INDEX IF NOT EXISTS idx_store_employees_merchant_store
        ON public.store_employees(merchant_id, store_id);
      CREATE INDEX IF NOT EXISTS idx_store_employees_store
        ON public.store_employees(store_id);

      CREATE TABLE IF NOT EXISTS public.employee_store_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id uuid NOT NULL REFERENCES public.merchants(id),
        store_id uuid NOT NULL REFERENCES public.stores(id),
        employee_store_id uuid NOT NULL REFERENCES public.store_employees(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES public.roles(id),
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
