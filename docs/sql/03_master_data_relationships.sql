-- 03: Missing master-data relationships (PDF sections 3-6 and 13).
-- Run after the parent tables exist. Transactional and safe to rerun for this version.
-- Supports canonical UUID parents and current application varchar parent IDs.
-- Supports stores/subscriptions using either merchant_id or quoted "merchantId".
-- Leaves existing IDs, data, parent columns, and subscription behavior unchanged.
-- Existing relationship tables must already match this DDL; IF NOT EXISTS is not an upgrade.
-- Applications must supply merchant_id on employee/store/role and subscription/store links.
BEGIN;
SET LOCAL search_path = public, pg_catalog;

DO $migration$
DECLARE
    merchant_type text;
    store_type text;
    subscription_type text;
    store_merchant text;
    subscription_merchant text;
    parent text;
    statement text;
BEGIN
    FOREACH parent IN ARRAY ARRAY['merchants','stores','employees','roles','subscriptions',
        'store_types','features','permissions','role_templates','plans'] LOOP
        IF to_regclass('public.' || parent) IS NULL THEN
            RAISE EXCEPTION 'Missing parent table public.%; install parent schema first', parent;
        END IF;
    END LOOP;
    SELECT format_type(atttypid, atttypmod) INTO STRICT merchant_type
        FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'id' AND NOT attisdropped;
    SELECT format_type(atttypid, atttypmod) INTO STRICT store_type
        FROM pg_attribute WHERE attrelid = 'public.stores'::regclass AND attname = 'id' AND NOT attisdropped;
    SELECT format_type(atttypid, atttypmod) INTO STRICT subscription_type
        FROM pg_attribute WHERE attrelid = 'public.subscriptions'::regclass AND attname = 'id' AND NOT attisdropped;
    SELECT quote_ident(attname) INTO STRICT store_merchant FROM pg_attribute
        WHERE attrelid = 'public.stores'::regclass AND attname IN ('merchant_id','merchantId') AND NOT attisdropped;
    SELECT quote_ident(attname) INTO STRICT subscription_merchant FROM pg_attribute
        WHERE attrelid = 'public.subscriptions'::regclass AND attname IN ('merchant_id','merchantId') AND NOT attisdropped;
    -- Ambiguous dual owner columns fail above instead of guessing tenant ownership.
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS pch_stores_tenant_id ON public.stores (%s, id)', store_merchant);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS pch_subscriptions_tenant_id ON public.subscriptions (%s, id)', subscription_merchant);
    CREATE UNIQUE INDEX IF NOT EXISTS pch_employees_tenant_id ON public.employees (merchant_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS pch_roles_tenant_id ON public.roles (merchant_id, id);

    statement := $ddl$
CREATE TABLE IF NOT EXISTS public.store_type_features (
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

CREATE TABLE IF NOT EXISTS public.store_type_role_templates (
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

CREATE TABLE IF NOT EXISTS public.plan_entitlements (
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

CREATE TABLE IF NOT EXISTS public.subscription_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id __MERCHANT_TYPE__ NOT NULL, -- Shared tenant, enforced against both parents.
    subscription_id __SUBSCRIPTION_TYPE__ NOT NULL,
    store_id __STORE_TYPE__ NOT NULL,
    status VARCHAR(30) NOT NULL,
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    CONSTRAINT ck_subscription_stores_activation_period
        CHECK (deactivated_at IS NULL OR activated_at IS NULL OR deactivated_at >= activated_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_subscription_stores_tenant_subscription
        FOREIGN KEY (merchant_id, subscription_id) REFERENCES public.subscriptions(__SUBSCRIPTION_MERCHANT__, id),
    CONSTRAINT fk_subscription_stores_tenant_store
        FOREIGN KEY (merchant_id, store_id) REFERENCES public.stores(__STORE_MERCHANT__, id),
    CONSTRAINT uq_subscription_store UNIQUE (subscription_id, store_id),
    CONSTRAINT fk_subscription_stores_subscription
        FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id),
    CONSTRAINT fk_subscription_stores_store
        FOREIGN KEY (store_id) REFERENCES public.stores(id)
);

CREATE TABLE IF NOT EXISTS public.subscription_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id __SUBSCRIPTION_TYPE__ NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.store_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id __STORE_TYPE__ NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.employee_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id __MERCHANT_TYPE__ NOT NULL, -- Shared tenant, enforced against both parents.
    employee_id UUID NOT NULL,
    store_id __STORE_TYPE__ NOT NULL,
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
        FOREIGN KEY (merchant_id, store_id) REFERENCES public.stores(__STORE_MERCHANT__, id),
    CONSTRAINT uq_employee_store UNIQUE (employee_id, store_id),
    CONSTRAINT fk_employee_stores_employee
        FOREIGN KEY (employee_id) REFERENCES public.employees(id),
    CONSTRAINT fk_employee_stores_store
        FOREIGN KEY (store_id) REFERENCES public.stores(id)
);

CREATE TABLE IF NOT EXISTS public.employee_store_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id __MERCHANT_TYPE__ NOT NULL, -- Shared tenant, enforced against both parents.
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

CREATE TABLE IF NOT EXISTS public.role_template_permissions (
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

CREATE TABLE IF NOT EXISTS public.role_permissions (
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
$ddl$;
    statement := replace(statement, '__MERCHANT_TYPE__', merchant_type);
    statement := replace(statement, '__STORE_TYPE__', store_type);
    statement := replace(statement, '__SUBSCRIPTION_TYPE__', subscription_type);
    statement := replace(statement, '__STORE_MERCHANT__', store_merchant);
    statement := replace(statement, '__SUBSCRIPTION_MERCHANT__', subscription_merchant);
    EXECUTE statement;
END
$migration$;

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

COMMIT;
