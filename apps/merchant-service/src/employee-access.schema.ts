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
          FROM pg_attribute WHERE attrelid='public.merchants'::regclass AND attname='merchant_code' AND NOT attisdropped;
        SELECT format_type(atttypid, atttypmod) INTO STRICT store_type
          FROM pg_attribute WHERE attrelid='public.stores'::regclass AND attname='legacy_store_id' AND NOT attisdropped;
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
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id),
            employee_code varchar(50) NOT NULL UNIQUE, first_name varchar(100) NOT NULL,
            last_name varchar(100) NOT NULL DEFAULT '', email varchar(255), phone varchar(50),
            status varchar(20) NOT NULL DEFAULT 'ACTIVE',
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS public.roles (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id __MERCHANT_TYPE__ NOT NULL REFERENCES public.merchants(merchant_code),
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
      ALTER TABLE public.employees
        ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS date_of_birth date,
        ADD COLUMN IF NOT EXISTS gender varchar(20),
        ADD COLUMN IF NOT EXISTS address_line_1 varchar(150) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS address_line_2 varchar(150) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS city varchar(50) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS state varchar(50) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS postal_code varchar(20) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS country varchar(50) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS username varchar(30),
        ADD COLUMN IF NOT EXISTS login_pin_hash varchar(128),
        ADD COLUMN IF NOT EXISTS password_hash varchar(128),
        ADD COLUMN IF NOT EXISTS send_credentials boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
      ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_key;
      CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_code ON public.employees(merchant_id,employee_code);
      CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_username ON public.employees(merchant_id,lower(username)) WHERE username IS NOT NULL;
      DO $schema$
      BEGIN
        IF to_regclass('public.users') IS NOT NULL THEN
          ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username varchar(100);
          ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "merchantId" varchar(100);
          ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "employeeId" uuid;
          CREATE UNIQUE INDEX IF NOT EXISTS pch_users_username ON public.users(lower(username)) WHERE username IS NOT NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS pch_users_employee ON public.users("employeeId") WHERE "employeeId" IS NOT NULL;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employees_user_fk') THEN
            ALTER TABLE public.employees ADD CONSTRAINT employees_user_fk FOREIGN KEY(user_id) REFERENCES public.users(id);
          END IF;
        END IF;
      END $schema$;
    `);
    await manager.query(`
      DO $schema$
      DECLARE merchant_type text; store_type text; store_owner text; ddl text;
      BEGIN
        SELECT format_type(atttypid, atttypmod) INTO STRICT merchant_type FROM pg_attribute
          WHERE attrelid='public.merchants'::regclass AND attname='merchant_code' AND NOT attisdropped;
        SELECT format_type(atttypid, atttypmod) INTO STRICT store_type FROM pg_attribute
          WHERE attrelid='public.stores'::regclass AND attname='legacy_store_id' AND NOT attisdropped;
        SELECT quote_ident(attname) INTO STRICT store_owner FROM pg_attribute
          WHERE attrelid='public.stores'::regclass AND attname IN ('merchant_id','merchantId') AND NOT attisdropped;
        CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_id ON public.employees(merchant_id,id);
        CREATE UNIQUE INDEX IF NOT EXISTS pch_roles_tenant_id ON public.roles(merchant_id,id);
        CREATE UNIQUE INDEX IF NOT EXISTS pch_roles_tenant_code ON public.roles(merchant_id,role_code);
        EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS pch_stores_tenant_id ON public.stores(%s,legacy_store_id)',store_owner);
        ddl := $ddl$
          CREATE TABLE IF NOT EXISTS public.employee_stores (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL,
            employee_id uuid NOT NULL, store_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false,
            status varchar(30) NOT NULL DEFAULT 'ACTIVE', effective_from timestamptz, effective_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(employee_id,store_id), UNIQUE(merchant_id,store_id,id),
            FOREIGN KEY(merchant_id) REFERENCES public.merchants(id),
            FOREIGN KEY(employee_id) REFERENCES public.employees(id),
            FOREIGN KEY(merchant_id,store_id) REFERENCES public.stores(merchant_uuid,id),
            CHECK(status IN ('ACTIVE','INACTIVE','SUSPENDED')),
            CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until>effective_from)
          );
          CREATE TABLE IF NOT EXISTS public.employee_store_roles (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, store_id uuid NOT NULL,
            employee_store_id uuid NOT NULL, role_id uuid NOT NULL,
            status varchar(30) NOT NULL DEFAULT 'ACTIVE', effective_from timestamptz, effective_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(employee_store_id,role_id),
            FOREIGN KEY(merchant_id,store_id,employee_store_id) REFERENCES public.employee_stores(merchant_id,store_id,id),
            FOREIGN KEY(role_id) REFERENCES public.roles(id),
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
    await manager.query(`
      ALTER TABLE public.merchants ALTER COLUMN id SET DEFAULT gen_random_uuid(), ALTER COLUMN id SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS merchants_generated_id_uq ON public.merchants(id);
      ALTER TABLE public.stores
        ADD COLUMN IF NOT EXISTS merchant_uuid uuid;
      ALTER TABLE public.stores ALTER COLUMN id SET DEFAULT gen_random_uuid();
      UPDATE public.stores s SET merchant_uuid=m.id FROM public.merchants m
        WHERE COALESCE(to_jsonb(s)->>'merchant_id',to_jsonb(s)->>'merchantId')=m.merchant_code::text
          AND s.merchant_uuid IS NULL;
      ALTER TABLE public.stores ALTER COLUMN id SET NOT NULL, ALTER COLUMN merchant_uuid SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS stores_generated_id_uq ON public.stores(id);
      CREATE UNIQUE INDEX IF NOT EXISTS stores_merchant_uuid_uq ON public.stores(merchant_uuid,id);
    `);
    await manager.query(`
      DO $schema$
      DECLARE item record;
      BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='employees' AND column_name='merchant_id') <> 'uuid' THEN
          ALTER TABLE public.employees ADD COLUMN merchant_uuid_tmp uuid;
          UPDATE public.employees e SET merchant_uuid_tmp=m.id FROM public.merchants m
            WHERE m.merchant_code::text=e.merchant_id::text OR m.id::text=e.merchant_id::text;
          IF EXISTS (SELECT 1 FROM public.employees WHERE merchant_uuid_tmp IS NULL) THEN
            RAISE EXCEPTION 'Cannot migrate employees: unresolved merchant_id';
          END IF;
          FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='public.employees'::regclass AND contype IN ('f','u') LOOP
            EXECUTE format('ALTER TABLE public.employees DROP CONSTRAINT %I',item.conname);
          END LOOP;
          ALTER TABLE public.employees DROP COLUMN merchant_id;
          ALTER TABLE public.employees RENAME COLUMN merchant_uuid_tmp TO merchant_id;
        END IF;
      END $schema$;
      ALTER TABLE public.employees ALTER COLUMN merchant_id SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_code ON public.employees(merchant_id,employee_code);
      CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_username ON public.employees(merchant_id,lower(username)) WHERE username IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_id ON public.employees(merchant_id,id);
      DO $schema$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employees_merchant_uuid_fk') THEN
          ALTER TABLE public.employees ADD CONSTRAINT employees_merchant_uuid_fk FOREIGN KEY(merchant_id) REFERENCES public.merchants(id);
        END IF;
      END $schema$;
    `);
    await manager.query(`
      DO $schema$
      DECLARE item record;
      BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_stores' AND column_name='merchant_id') <> 'uuid'
           OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_stores' AND column_name='store_id') <> 'uuid' THEN
          ALTER TABLE public.employee_stores ADD COLUMN merchant_uuid_tmp uuid, ADD COLUMN store_uuid_tmp uuid;
          UPDATE public.employee_stores es SET merchant_uuid_tmp=m.id,store_uuid_tmp=s.id
            FROM public.merchants m,public.stores s
            WHERE m.merchant_code::text=es.merchant_id::text
              AND (s.legacy_store_id::text=es.store_id::text OR s.id::text=es.store_id::text)
              AND s.merchant_uuid=m.id;
          IF EXISTS (SELECT 1 FROM public.employee_stores WHERE merchant_uuid_tmp IS NULL OR store_uuid_tmp IS NULL) THEN
            RAISE EXCEPTION 'Cannot migrate employee_stores: unresolved merchant_id or store_id';
          END IF;
          FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='public.employee_store_roles'::regclass AND contype IN ('f','u') LOOP
            EXECUTE format('ALTER TABLE public.employee_store_roles DROP CONSTRAINT %I',item.conname);
          END LOOP;
          FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='public.employee_stores'::regclass AND contype IN ('f','u') LOOP
            EXECUTE format('ALTER TABLE public.employee_stores DROP CONSTRAINT %I',item.conname);
          END LOOP;
          ALTER TABLE public.employee_stores DROP COLUMN merchant_id, DROP COLUMN store_id;
          ALTER TABLE public.employee_stores RENAME COLUMN merchant_uuid_tmp TO merchant_id;
          ALTER TABLE public.employee_stores RENAME COLUMN store_uuid_tmp TO store_id;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_store_roles' AND column_name='store_id')
           OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_store_roles' AND column_name='merchant_id') <> 'uuid' THEN
          ALTER TABLE public.employee_store_roles ADD COLUMN IF NOT EXISTS merchant_uuid_tmp uuid;
          ALTER TABLE public.employee_store_roles ADD COLUMN IF NOT EXISTS store_uuid_tmp uuid;
          UPDATE public.employee_store_roles esr SET merchant_uuid_tmp=es.merchant_id,store_uuid_tmp=es.store_id
            FROM public.employee_stores es WHERE es.id=esr.employee_store_id;
          IF EXISTS (SELECT 1 FROM public.employee_store_roles WHERE merchant_uuid_tmp IS NULL OR store_uuid_tmp IS NULL) THEN
            RAISE EXCEPTION 'Cannot migrate employee_store_roles: unresolved merchant_id or store_id';
          END IF;
          ALTER TABLE public.employee_store_roles DROP COLUMN merchant_id;
          ALTER TABLE public.employee_store_roles RENAME COLUMN merchant_uuid_tmp TO merchant_id;
          ALTER TABLE public.employee_store_roles RENAME COLUMN store_uuid_tmp TO store_id;
        END IF;
      END $schema$;
      ALTER TABLE public.employee_stores ALTER COLUMN merchant_id SET NOT NULL,ALTER COLUMN store_id SET NOT NULL;
      ALTER TABLE public.employee_store_roles ALTER COLUMN merchant_id SET NOT NULL,ALTER COLUMN store_id SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS employee_stores_employee_store_uq ON public.employee_stores(employee_id,store_id);
      CREATE UNIQUE INDEX IF NOT EXISTS employee_stores_tenant_assignment_uq ON public.employee_stores(merchant_id,store_id,id);
      CREATE UNIQUE INDEX IF NOT EXISTS employee_store_roles_assignment_role_uq ON public.employee_store_roles(employee_store_id,role_id);
      DO $schema$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_stores_merchant_uuid_fk') THEN
          ALTER TABLE public.employee_stores ADD CONSTRAINT employee_stores_merchant_uuid_fk FOREIGN KEY(merchant_id) REFERENCES public.merchants(id);
          ALTER TABLE public.employee_stores ADD CONSTRAINT employee_stores_employee_uuid_fk FOREIGN KEY(employee_id) REFERENCES public.employees(id);
          ALTER TABLE public.employee_stores ADD CONSTRAINT employee_stores_store_uuid_fk FOREIGN KEY(merchant_id,store_id) REFERENCES public.stores(merchant_uuid,id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='employee_store_roles_assignment_uuid_fk') THEN
          ALTER TABLE public.employee_store_roles ADD CONSTRAINT employee_store_roles_assignment_uuid_fk FOREIGN KEY(merchant_id,store_id,employee_store_id) REFERENCES public.employee_stores(merchant_id,store_id,id);
          ALTER TABLE public.employee_store_roles ADD CONSTRAINT employee_store_roles_role_uuid_fk FOREIGN KEY(role_id) REFERENCES public.roles(id);
        END IF;
      END $schema$;
    `);
    await manager.query(`
      DO $schema$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='merchant_id') THEN
          ALTER TABLE public.role_permissions ADD COLUMN merchant_id uuid;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='store_id') THEN
          ALTER TABLE public.role_permissions ADD COLUMN store_id uuid;
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='merchant_id') <> 'uuid'
           OR (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='store_id') <> 'uuid' THEN
          RAISE EXCEPTION 'role_permissions merchant_id and store_id must be migrated to UUID';
        END IF;
      END $schema$;
      UPDATE public.role_permissions rp SET merchant_id=m.id FROM public.roles r
        JOIN public.merchants m ON m.merchant_code::text=r.merchant_id::text
        WHERE r.id=rp.role_id AND rp.merchant_id IS NULL;
      ALTER TABLE public.role_permissions ALTER COLUMN merchant_id SET NOT NULL, ALTER COLUMN store_id SET NOT NULL;
      DO $schema$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='role_permissions_merchant_fk') THEN
          ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_merchant_fk
            FOREIGN KEY(merchant_id) REFERENCES public.merchants(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='role_permissions_store_fk') THEN
          ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_store_fk
            FOREIGN KEY(merchant_id,store_id) REFERENCES public.stores(merchant_uuid,id);
        END IF;
      END $schema$;
    `);
    for (const index of [
      'CREATE UNIQUE INDEX IF NOT EXISTS pch_employee_one_primary_store ON public.employee_stores(employee_id) WHERE is_primary',
      'CREATE INDEX IF NOT EXISTS pch_employee_stores_store ON public.employee_stores(store_id)',
      'CREATE INDEX IF NOT EXISTS pch_employee_store_roles_role ON public.employee_store_roles(role_id)',
      'CREATE INDEX IF NOT EXISTS pch_role_permissions_permission ON public.role_permissions(permission_id)',
      'CREATE INDEX IF NOT EXISTS pch_role_permissions_merchant_store ON public.role_permissions(merchant_id,store_id)',
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
