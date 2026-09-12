-- PCH canonical master-data schema, based on the September 2026 architecture PDF.
-- PostgreSQL 14+. Install into an EMPTY database/schema; this is not a legacy migration.
-- All 20 documented tables are included, in parent-before-child order.
-- UUID identifiers follow the uploaded SQL. Existing application text IDs are NOT converted.
-- Tenant columns on assignment tables prevent cross-merchant links using composite FKs.
-- Status values use uppercase application conventions. Effective access still requires
-- server-side licensing, date, employee-status and permission checks (PDF sections 7/14).
-- No rows are deleted and no commercial entitlement or employee role is granted here.
BEGIN;
SET LOCAL search_path = public, pg_catalog;

-- =========================================================
-- 1. MASTER TABLES
-- =========================================================

CREATE TABLE public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_code VARCHAR(50) NOT NULL UNIQUE,
    business_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    timezone VARCHAR(100),
    currency VARCHAR(10),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.store_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    CONSTRAINT uq_stores_tenant_id UNIQUE (merchant_id, id),
    store_type_id UUID NOT NULL,
    store_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100),
    currency VARCHAR(10),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(120),
    state VARCHAR(120),
    postal_code VARCHAR(30),
    country VARCHAR(120),
    woocommerce_store_id VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_stores_merchant
        FOREIGN KEY (merchant_id) REFERENCES public.merchants(id),
    CONSTRAINT fk_stores_store_type
        FOREIGN KEY (store_type_id) REFERENCES public.store_types(id)
);

CREATE TABLE public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    CONSTRAINT uq_employees_tenant_id UNIQUE (merchant_id, id),
    employee_code VARCHAR(50) NOT NULL UNIQUE,
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120),
    email VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_employees_merchant
        FOREIGN KEY (merchant_id) REFERENCES public.merchants(id)
);

CREATE TABLE public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    billing_model VARCHAR(50),
    base_price NUMERIC(12,2) CHECK (base_price >= 0 AND base_price <> 'NaN'::NUMERIC),
    currency VARCHAR(10), -- Explicit currency for the commercial price.
    billing_cycle VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    feature_type VARCHAR(30) NOT NULL CHECK (feature_type IN ('BOOLEAN', 'LIMIT', 'CONFIG')), -- BOOLEAN / LIMIT / CONFIG
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id UUID NOT NULL,
    permission_key VARCHAR(120) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_permissions_feature
        FOREIGN KEY (feature_id) REFERENCES public.features(id)
);

CREATE TABLE public.role_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    scope_type VARCHAR(30) NOT NULL CHECK (scope_type IN ('MERCHANT', 'STORE')), -- MERCHANT / STORE
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    CONSTRAINT uq_roles_tenant_id UNIQUE (merchant_id, id),
    source_role_template_id UUID,
    role_code VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    scope_type VARCHAR(30) NOT NULL CHECK (scope_type IN ('MERCHANT', 'STORE')), -- MERCHANT / STORE
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_roles_merchant_code UNIQUE (merchant_id, role_code),
    CONSTRAINT fk_roles_merchant
        FOREIGN KEY (merchant_id) REFERENCES public.merchants(id),
    CONSTRAINT fk_roles_source_template
        FOREIGN KEY (source_role_template_id) REFERENCES public.role_templates(id)
);

-- =========================================================
-- 2. STORE TYPE MAPPINGS
-- =========================================================

CREATE TABLE public.store_type_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_id UUID NOT NULL,
    feature_id UUID NOT NULL,
    default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER,
    configuration_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_type_feature UNIQUE (store_type_id, feature_id),
    CONSTRAINT fk_store_type_features_store_type
        FOREIGN KEY (store_type_id) REFERENCES public.store_types(id),
    CONSTRAINT fk_store_type_features_feature
        FOREIGN KEY (feature_id) REFERENCES public.features(id)
);

CREATE TABLE public.store_type_role_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_id UUID NOT NULL,
    role_template_id UUID NOT NULL,
    default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_type_role_template UNIQUE (store_type_id, role_template_id),
    CONSTRAINT fk_store_type_role_templates_store_type
        FOREIGN KEY (store_type_id) REFERENCES public.store_types(id),
    CONSTRAINT fk_store_type_role_templates_role_template
        FOREIGN KEY (role_template_id) REFERENCES public.role_templates(id)
);

-- =========================================================
-- 3. PLAN / SUBSCRIPTION / ENTITLEMENTS
-- =========================================================

CREATE TABLE public.plan_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    feature_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    limit_value VARCHAR(100),
    configuration_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_entitlement UNIQUE (plan_id, feature_id),
    CONSTRAINT fk_plan_entitlements_plan
        FOREIGN KEY (plan_id) REFERENCES public.plans(id),
    CONSTRAINT fk_plan_entitlements_feature
        FOREIGN KEY (feature_id) REFERENCES public.features(id)
);

CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_code VARCHAR(100) NOT NULL UNIQUE,
    merchant_id UUID NOT NULL,
    CONSTRAINT uq_subscriptions_tenant_id UNIQUE (merchant_id, id),
    plan_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL,
    billing_cycle VARCHAR(30),
    start_date DATE,
    renewal_date DATE,
    trial_end_date DATE,
    licensed_store_count INTEGER CHECK (licensed_store_count >= 0),
    licensed_device_count INTEGER CHECK (licensed_device_count >= 0),
    price NUMERIC(12,2) CHECK (price >= 0 AND price <> 'NaN'::NUMERIC),
    currency VARCHAR(10),
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_subscriptions_merchant
        FOREIGN KEY (merchant_id) REFERENCES public.merchants(id),
    CONSTRAINT fk_subscriptions_plan
        FOREIGN KEY (plan_id) REFERENCES public.plans(id)
);

CREATE TABLE public.subscription_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL, -- Shared tenant, enforced against both parents.
    subscription_id UUID NOT NULL,
    store_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL,
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    CONSTRAINT ck_subscription_stores_activation_period
        CHECK (deactivated_at IS NULL OR activated_at IS NULL OR deactivated_at >= activated_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_subscription_stores_tenant_subscription
        FOREIGN KEY (merchant_id, subscription_id) REFERENCES public.subscriptions(merchant_id, id),
    CONSTRAINT fk_subscription_stores_tenant_store
        FOREIGN KEY (merchant_id, store_id) REFERENCES public.stores(merchant_id, id),
    CONSTRAINT uq_subscription_store UNIQUE (subscription_id, store_id),
    CONSTRAINT fk_subscription_stores_subscription
        FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id),
    CONSTRAINT fk_subscription_stores_store
        FOREIGN KEY (store_id) REFERENCES public.stores(id)
);

CREATE TABLE public.subscription_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL,
    feature_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    limit_value VARCHAR(100),
    source VARCHAR(100),
    effective_from TIMESTAMPTZ,
    effective_until TIMESTAMPTZ,
    CONSTRAINT ck_subscription_entitlements_effective_period
        CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscription_entitlement UNIQUE (subscription_id, feature_id),
    CONSTRAINT fk_subscription_entitlements_subscription
        FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id),
    CONSTRAINT fk_subscription_entitlements_feature
        FOREIGN KEY (feature_id) REFERENCES public.features(id)
);

CREATE TABLE public.store_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL,
    feature_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    limit_value VARCHAR(100),
    source VARCHAR(100),
    effective_from TIMESTAMPTZ,
    effective_until TIMESTAMPTZ,
    CONSTRAINT ck_store_entitlements_effective_period
        CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_entitlement UNIQUE (store_id, feature_id),
    CONSTRAINT fk_store_entitlements_store
        FOREIGN KEY (store_id) REFERENCES public.stores(id),
    CONSTRAINT fk_store_entitlements_feature
        FOREIGN KEY (feature_id) REFERENCES public.features(id)
);

-- =========================================================
-- 4. EMPLOYEE / ROLE / PERMISSION MODEL
-- =========================================================

CREATE TABLE public.employee_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL, -- Shared tenant, enforced against both parents.
    employee_id UUID NOT NULL,
    store_id UUID NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    effective_from TIMESTAMPTZ,
    effective_until TIMESTAMPTZ,
    CONSTRAINT ck_employee_stores_effective_period
        CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_employee_stores_tenant_id UNIQUE (merchant_id, id),
    CONSTRAINT fk_employee_stores_tenant_employee
        FOREIGN KEY (merchant_id, employee_id) REFERENCES public.employees(merchant_id, id),
    CONSTRAINT fk_employee_stores_tenant_store
        FOREIGN KEY (merchant_id, store_id) REFERENCES public.stores(merchant_id, id),
    CONSTRAINT uq_employee_store UNIQUE (employee_id, store_id),
    CONSTRAINT fk_employee_stores_employee
        FOREIGN KEY (employee_id) REFERENCES public.employees(id),
    CONSTRAINT fk_employee_stores_store
        FOREIGN KEY (store_id) REFERENCES public.stores(id)
);

CREATE TABLE public.employee_store_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL, -- Shared tenant, enforced against both parents.
    employee_store_id UUID NOT NULL,
    role_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    effective_from TIMESTAMPTZ,
    effective_until TIMESTAMPTZ,
    CONSTRAINT ck_employee_store_roles_effective_period
        CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_employee_store_roles_tenant_assignment
        FOREIGN KEY (merchant_id, employee_store_id) REFERENCES public.employee_stores(merchant_id, id),
    CONSTRAINT fk_employee_store_roles_tenant_role
        FOREIGN KEY (merchant_id, role_id) REFERENCES public.roles(merchant_id, id),
    CONSTRAINT uq_employee_store_role UNIQUE (employee_store_id, role_id),
    CONSTRAINT fk_employee_store_roles_employee_store
        FOREIGN KEY (employee_store_id) REFERENCES public.employee_stores(id),
    CONSTRAINT fk_employee_store_roles_role
        FOREIGN KEY (role_id) REFERENCES public.roles(id)
);

CREATE TABLE public.role_template_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_template_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    default_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_template_permission UNIQUE (role_template_id, permission_id),
    CONSTRAINT fk_role_template_permissions_role_template
        FOREIGN KEY (role_template_id) REFERENCES public.role_templates(id),
    CONSTRAINT fk_role_template_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);

CREATE TABLE public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES public.roles(id),
    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);

-- =========================================================
-- 5. RECOMMENDED INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_stores_merchant_id
    ON public.stores(merchant_id);

CREATE INDEX IF NOT EXISTS idx_stores_store_type_id
    ON public.stores(store_type_id);

CREATE INDEX IF NOT EXISTS idx_employees_merchant_id
    ON public.employees(merchant_id);

CREATE INDEX IF NOT EXISTS idx_permissions_feature_id
    ON public.permissions(feature_id);

CREATE INDEX IF NOT EXISTS idx_roles_merchant_id
    ON public.roles(merchant_id);

CREATE INDEX IF NOT EXISTS idx_roles_source_role_template_id
    ON public.roles(source_role_template_id);

CREATE INDEX IF NOT EXISTS idx_store_type_features_store_type_id
    ON public.store_type_features(store_type_id);

CREATE INDEX IF NOT EXISTS idx_store_type_features_feature_id
    ON public.store_type_features(feature_id);

CREATE INDEX IF NOT EXISTS idx_store_type_role_templates_store_type_id
    ON public.store_type_role_templates(store_type_id);

CREATE INDEX IF NOT EXISTS idx_store_type_role_templates_role_template_id
    ON public.store_type_role_templates(role_template_id);

CREATE INDEX IF NOT EXISTS idx_plan_entitlements_plan_id
    ON public.plan_entitlements(plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_entitlements_feature_id
    ON public.plan_entitlements(feature_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant_id
    ON public.subscriptions(merchant_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id
    ON public.subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS idx_subscription_stores_subscription_id
    ON public.subscription_stores(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_stores_store_id
    ON public.subscription_stores(store_id);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_subscription_id
    ON public.subscription_entitlements(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_feature_id
    ON public.subscription_entitlements(feature_id);

CREATE INDEX IF NOT EXISTS idx_store_entitlements_store_id
    ON public.store_entitlements(store_id);

CREATE INDEX IF NOT EXISTS idx_store_entitlements_feature_id
    ON public.store_entitlements(feature_id);

CREATE INDEX IF NOT EXISTS idx_employee_stores_employee_id
    ON public.employee_stores(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_stores_store_id
    ON public.employee_stores(store_id);

CREATE INDEX IF NOT EXISTS idx_employee_store_roles_employee_store_id
    ON public.employee_store_roles(employee_store_id);

CREATE INDEX IF NOT EXISTS idx_employee_store_roles_role_id
    ON public.employee_store_roles(role_id);

CREATE INDEX IF NOT EXISTS idx_role_template_permissions_role_template_id
    ON public.role_template_permissions(role_template_id);

CREATE INDEX IF NOT EXISTS idx_role_template_permissions_permission_id
    ON public.role_template_permissions(permission_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id
    ON public.role_permissions(role_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
    ON public.role_permissions(permission_id);

-- =========================================================
-- 6. RELATIONSHIP SUMMARY
-- =========================================================
-- Merchant -> Store                    1:N
-- Merchant -> Employee                 1:N
-- Merchant -> Subscription             1:N
-- Store Type -> Store                  1:N
-- Store Type <-> Feature               N:M via store_type_features
-- Store Type <-> Role Template         N:M via store_type_role_templates
-- Plan <-> Feature                     N:M via plan_entitlements
-- Subscription <-> Store               N:M via subscription_stores
-- Employee <-> Store                   N:M via employee_stores
-- EmployeeStore <-> Role               N:M via employee_store_roles
-- Role <-> Permission                  N:M via role_permissions
-- Feature -> Permission                1:N

COMMIT;
