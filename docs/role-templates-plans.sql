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


