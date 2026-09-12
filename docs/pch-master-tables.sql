-- PCH master data - Phase 1
-- Source: PCH_Master_Data_Relationships_UI_Mapping.pdf, sections 2 and 15.
-- PostgreSQL 13+. Run once in the intended PCH application database.
-- Scope: reusable masters only. Tenant data and relationship tables are later phases.
-- Existing public.subscription_plans is not changed. Existing APIs continue to use
-- that legacy catalog until an explicit data migration and API integration is done.
-- public.plans is the normalized catalog described in the reference document.
-- No sample pricing, entitlement grants, or business records are inserted.
-- This script is atomic and intentionally fails if a target table already exists,
-- rather than silently accepting a table with an incompatible definition.

BEGIN;

CREATE TABLE public.store_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT store_types_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE public.features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL,
    feature_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT features_type_valid
        CHECK (feature_type IN ('BOOLEAN', 'LIMIT', 'CONFIG', 'TEXT')),
    CONSTRAINT features_status_valid
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE public.permissions (
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

CREATE INDEX permissions_feature_id_idx ON public.permissions (feature_id);

CREATE TABLE public.role_templates (
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

CREATE TABLE public.plans (
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

-- Keep audit timestamps current for SQL clients as well as application writes.
CREATE FUNCTION public.pch_master_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER store_types_set_updated_at
    BEFORE UPDATE ON public.store_types
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

CREATE TRIGGER features_set_updated_at
    BEFORE UPDATE ON public.features
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

CREATE TRIGGER permissions_set_updated_at
    BEFORE UPDATE ON public.permissions
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

CREATE TRIGGER role_templates_set_updated_at
    BEFORE UPDATE ON public.role_templates
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

CREATE TRIGGER plans_set_updated_at
    BEFORE UPDATE ON public.plans
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

COMMENT ON TABLE public.store_types IS 'Reusable business vertical catalog; defaults do not grant commercial entitlements.';
COMMENT ON TABLE public.features IS 'Platform capability catalog; commercial entitlements are maintained separately.';
COMMENT ON TABLE public.permissions IS 'Actions belonging to a feature; defining a permission does not grant access.';
COMMENT ON TABLE public.role_templates IS 'Reusable role definitions; permission mappings and merchant roles are separate.';
COMMENT ON TABLE public.plans IS 'Normalized commercial package catalog; plan entitlements and subscriptions are separate.';
COMMENT ON COLUMN public.plans.currency IS 'Three-letter uppercase currency code for base_price; supported currencies validated by the application.';

COMMIT;
