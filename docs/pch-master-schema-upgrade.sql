CREATE TABLE IF NOT EXISTS public.store_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT store_types_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE IF EXISTS public.store_types
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS store_type_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL,
    feature_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT features_status_valid
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE IF EXISTS public.features
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS feature_key VARCHAR(100),
    ADD COLUMN IF NOT EXISTS name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS feature_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id UUID NOT NULL,
    permission_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT permissions_feature_fk FOREIGN KEY (feature_id)
        REFERENCES public.features (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT permissions_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE IF EXISTS public.permissions
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS feature_id UUID,
    ADD COLUMN IF NOT EXISTS permission_key VARCHAR(100),
    ADD COLUMN IF NOT EXISTS name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.role_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope_type VARCHAR(20) NOT NULL DEFAULT 'STORE',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT role_templates_scope_valid CHECK (scope_type IN ('MERCHANT', 'STORE')),
    CONSTRAINT role_templates_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE IF EXISTS public.role_templates
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS role_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    billing_model VARCHAR(20) NOT NULL,
    base_price NUMERIC(12,2) NOT NULL,
    -- Currency is explicit so base_price has an unambiguous monetary unit.
    currency VARCHAR(3) NOT NULL,
    billing_cycle VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plans_billing_model_valid CHECK (billing_model IN ('FLAT', 'PER_STORE', 'PER_DEVICE', 'CUSTOM')),
    CONSTRAINT plans_price_valid CHECK (base_price >= 0 AND base_price <> 'NaN'::NUMERIC),
    CONSTRAINT plans_billing_cycle_valid CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
    CONSTRAINT plans_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE IF EXISTS public.plans
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS plan_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS billing_model VARCHAR(20),
    ADD COLUMN IF NOT EXISTS base_price NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3),
    ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id VARCHAR(100) NOT NULL,
    employee_code VARCHAR(50) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL DEFAULT '',
    email VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employees_merchant_fk FOREIGN KEY (merchant_id)
        REFERENCES public.merchants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT employees_status_valid CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
    -- Supports tenant-safe composite FKs in future employee-store assignments.
    CONSTRAINT employees_merchant_id_id_unique UNIQUE (merchant_id, id)
);

ALTER TABLE IF EXISTS public.employees
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS merchant_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id VARCHAR(100) NOT NULL,
    source_role_template_id UUID,
    role_code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope_type VARCHAR(20) NOT NULL DEFAULT 'STORE',
    is_custom BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT roles_merchant_fk FOREIGN KEY (merchant_id)
        REFERENCES public.merchants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT roles_source_template_fk FOREIGN KEY (source_role_template_id)
        REFERENCES public.role_templates (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT roles_scope_valid CHECK (scope_type IN ('MERCHANT', 'STORE')),
    CONSTRAINT roles_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT roles_merchant_code_unique UNIQUE (merchant_id, role_code),
    -- Supports tenant-safe composite FKs in future employee-store-role mappings.
    CONSTRAINT roles_merchant_id_id_unique UNIQUE (merchant_id, id)
);

ALTER TABLE IF EXISTS public.roles
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS merchant_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS source_role_template_id UUID,
    ADD COLUMN IF NOT EXISTS role_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.merchants
    ADD COLUMN IF NOT EXISTS merchant_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

ALTER TABLE IF EXISTS public.stores
    ADD COLUMN IF NOT EXISTS store_type_id UUID,
    ADD COLUMN IF NOT EXISTS woocommerce_store_id VARCHAR(100);
