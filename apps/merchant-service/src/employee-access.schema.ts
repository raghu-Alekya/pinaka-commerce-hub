import { DataSource, EntityManager } from 'typeorm';

/** Additive, repository-owned section 5 schema. No global TypeORM synchronization required. */
export async function ensureEmployeeAccessSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 1)');
    await manager.query(`
      DO $schema$
      DECLARE merchant_type text; store_type text; store_owner text; ddl text;
      BEGIN
        SELECT format_type(atttypid, atttypmod) INTO STRICT merchant_type
          FROM pg_attribute WHERE attrelid='public.merchants'::regclass AND attname='id' AND NOT attisdropped;
        SELECT format_type(atttypid, atttypmod) INTO STRICT store_type
          FROM pg_attribute WHERE attrelid='public.stores'::regclass AND attname='id' AND NOT attisdropped;
        SELECT quote_ident(attname) INTO STRICT store_owner FROM pg_attribute
          WHERE attrelid='public.stores'::regclass AND attname IN ('merchant_id','merchantId') AND NOT attisdropped;
        ddl := $ddl$
          CREATE TABLE IF NOT EXISTS public.role_templates (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_code varchar(50) NOT NULL UNIQUE,
            name varchar(100) NOT NULL, description text NOT NULL DEFAULT '',
            scope_type varchar(20) NOT NULL DEFAULT 'STORE', status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS public.permissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_id uuid NOT NULL,
            permission_key varchar(100) NOT NULL UNIQUE, name varchar(150) NOT NULL,
            description text NOT NULL DEFAULT '', status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT permissions_feature_fk FOREIGN KEY (feature_id) REFERENCES public.features(id)
          );
          CREATE TABLE IF NOT EXISTS public.employees (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id __MERCHANT_TYPE__ NOT NULL REFERENCES public.merchants(id),
            employee_code varchar(50) NOT NULL UNIQUE, first_name varchar(100) NOT NULL,
            last_name varchar(100) NOT NULL DEFAULT '', email varchar(255), phone varchar(50),
            status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS public.roles (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id __MERCHANT_TYPE__ NOT NULL REFERENCES public.merchants(id),
            source_role_template_id uuid REFERENCES public.role_templates(id), role_code varchar(50) NOT NULL,
            name varchar(100) NOT NULL, description text NOT NULL DEFAULT '', scope_type varchar(20) NOT NULL DEFAULT 'STORE',
            is_custom boolean NOT NULL DEFAULT true, status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (merchant_id, role_code)
          );
        $ddl$;
        EXECUTE replace(ddl, '__MERCHANT_TYPE__', merchant_type);
      END $schema$;
    `);
    // Older application builds used camelCase entity columns. Preserve their data.
    await renameLegacyCamelCaseColumns(manager, {
      employees: ['merchantId', 'employeeCode', 'firstName', 'lastName', 'createdAt', 'updatedAt'],
      roles: ['merchantId', 'sourceRoleTemplateId', 'roleCode', 'scopeType', 'isCustom', 'createdAt', 'updatedAt'],
      role_templates: ['roleCode', 'scopeType', 'createdAt', 'updatedAt'],
      permissions: ['featureId', 'permissionKey', 'createdAt', 'updatedAt'],
    });
    await manager.query(`
      DO $schema$
      DECLARE merchant_type text; store_type text; store_owner text; ddl text;
      BEGIN
        SELECT format_type(atttypid, atttypmod) INTO STRICT merchant_type FROM pg_attribute
          WHERE attrelid='public.merchants'::regclass AND attname='id' AND NOT attisdropped;
        SELECT format_type(atttypid, atttypmod) INTO STRICT store_type FROM pg_attribute
          WHERE attrelid='public.stores'::regclass AND attname='id' AND NOT attisdropped;
        SELECT quote_ident(attname) INTO STRICT store_owner FROM pg_attribute
          WHERE attrelid='public.stores'::regclass AND attname IN ('merchant_id','merchantId') AND NOT attisdropped;
        CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_id ON public.employees(merchant_id,id);
        CREATE UNIQUE INDEX IF NOT EXISTS pch_roles_tenant_id ON public.roles(merchant_id,id);
        CREATE UNIQUE INDEX IF NOT EXISTS pch_roles_tenant_code ON public.roles(merchant_id,role_code);
        EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS pch_stores_tenant_id ON public.stores(%s,id)',store_owner);
        ddl := $ddl$
          CREATE TABLE IF NOT EXISTS public.employee_stores (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id __MERCHANT_TYPE__ NOT NULL,
            employee_id uuid NOT NULL, store_id __STORE_TYPE__ NOT NULL, is_primary boolean NOT NULL DEFAULT false,
            status varchar(30) NOT NULL DEFAULT 'ACTIVE', effective_from timestamptz, effective_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(employee_id,store_id), UNIQUE(merchant_id,id),
            FOREIGN KEY(merchant_id,employee_id) REFERENCES public.employees(merchant_id,id),
            FOREIGN KEY(merchant_id,store_id) REFERENCES public.stores(__STORE_OWNER__,id),
            CHECK(status IN ('ACTIVE','INACTIVE','SUSPENDED')),
            CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from)
          );
          CREATE TABLE IF NOT EXISTS public.employee_store_roles (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id __MERCHANT_TYPE__ NOT NULL,
            employee_store_id uuid NOT NULL, role_id uuid NOT NULL,
            status varchar(30) NOT NULL DEFAULT 'ACTIVE', effective_from timestamptz, effective_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(employee_store_id,role_id),
            FOREIGN KEY(merchant_id,employee_store_id) REFERENCES public.employee_stores(merchant_id,id),
            FOREIGN KEY(merchant_id,role_id) REFERENCES public.roles(merchant_id,id),
            CHECK(status IN ('ACTIVE','INACTIVE','SUSPENDED')),
            CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from)
          );
          CREATE TABLE IF NOT EXISTS public.role_template_permissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_template_id uuid NOT NULL REFERENCES public.role_templates(id),
            permission_id uuid NOT NULL REFERENCES public.permissions(id), default_allowed boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(role_template_id,permission_id)
          );
          CREATE TABLE IF NOT EXISTS public.role_permissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES public.roles(id),
            permission_id uuid NOT NULL REFERENCES public.permissions(id), allowed boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(role_id,permission_id)
          );
        $ddl$;
        ddl := replace(ddl,'__MERCHANT_TYPE__',merchant_type);
        ddl := replace(ddl,'__STORE_TYPE__',store_type);
        ddl := replace(ddl,'__STORE_OWNER__',store_owner);
        EXECUTE ddl;
      END $schema$;
    `);
    await renameLegacyCamelCaseColumns(manager, {
      employee_stores: ['merchantId', 'employeeId', 'storeId', 'isPrimary', 'effectiveFrom', 'effectiveUntil', 'createdAt', 'updatedAt'],
      employee_store_roles: ['merchantId', 'employeeStoreId', 'roleId', 'effectiveFrom', 'effectiveUntil', 'createdAt', 'updatedAt'],
      role_template_permissions: ['roleTemplateId', 'permissionId', 'defaultAllowed', 'createdAt', 'updatedAt'],
      role_permissions: ['roleId', 'permissionId', 'createdAt', 'updatedAt'],
    });
    for (const index of [
      'CREATE UNIQUE INDEX IF NOT EXISTS pch_employee_one_primary_store ON public.employee_stores(employee_id) WHERE is_primary',
      'CREATE INDEX IF NOT EXISTS pch_employee_stores_store ON public.employee_stores(store_id)',
      'CREATE INDEX IF NOT EXISTS pch_employee_store_roles_role ON public.employee_store_roles(role_id)',
      'CREATE INDEX IF NOT EXISTS pch_role_permissions_permission ON public.role_permissions(permission_id)',
      'CREATE INDEX IF NOT EXISTS pch_role_template_permissions_permission ON public.role_template_permissions(permission_id)',
    ]) await manager.query(index);
  });
}

async function renameLegacyCamelCaseColumns(manager: EntityManager, columns: Record<string, string[]>): Promise<void> {
  for (const [table, names] of Object.entries(columns)) {
    const existing = new Set((await manager.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table],
    )).map((row: { column_name: string }) => row.column_name));
    for (const from of names) {
      const to = from.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
      if (existing.has(from) && existing.has(to)) throw new Error(`Ambiguous schema: ${table} has both ${from} and ${to}`);
      if (existing.has(from)) {
        await manager.query(`ALTER TABLE public."${table}" RENAME COLUMN "${from}" TO "${to}"`);
        existing.delete(from);
        existing.add(to);
      }
    }
  }
}
