-- ==========================================================
-- 02: PCH Master & Tenant Tables Migration Script
-- Database: pinaka_commerce_hub
-- ==========================================================

-- 1. store_types Master Table
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

-- 2. features Master Table
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
    CONSTRAINT features_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
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

-- 3. permissions Master Table
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

-- 4. role_templates Master Table
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

-- 5. plans Master Table
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    billing_model VARCHAR(20) NOT NULL,
    base_price NUMERIC(12,2) NOT NULL,
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

-- 6. merchants Aligned Columns
ALTER TABLE IF EXISTS public.merchants
    ADD COLUMN IF NOT EXISTS merchant_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- 7. stores Aligned Columns & Constraints
ALTER TABLE IF EXISTS public.stores
    ADD COLUMN IF NOT EXISTS store_type_id VARCHAR(50) DEFAULT 'RETAIL',
    ADD COLUMN IF NOT EXISTS woocommerce_store_id VARCHAR(100);

-- 8. roles Tenant Table
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

-- 9. employees Tenant Table
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

-- ==========================================================
-- Initial Master Seed Data
-- ==========================================================

-- Seed Features
INSERT INTO public.features (id, feature_key, name, description, category, feature_type, status)
VALUES
  ('f1111111-0000-0000-0000-000000000001', 'ORDER_MANAGEMENT', 'Order Management', 'Manage in-store POS and online delivery orders', 'OPERATIONS', 'FLAG', 'ACTIVE'),
  ('f1111111-0000-0000-0000-000000000002', 'REFUNDS', 'Refunds & Returns', 'Process full and partial order refunds', 'FINANCIAL', 'FLAG', 'ACTIVE'),
  ('f1111111-0000-0000-0000-000000000003', 'KDS', 'Kitchen Display System', 'Live kitchen prep tickets and bump bar tracking', 'KITCHEN', 'FLAG', 'ACTIVE'),
  ('f1111111-0000-0000-0000-000000000004', 'LOYALTY', 'Loyalty & Rewards', 'Earn and redeem loyalty points at checkout', 'MARKETING', 'FLAG', 'ACTIVE'),
  ('f1111111-0000-0000-0000-000000000005', 'SAFE_DROP', 'Safe Drop & Cash Management', 'Mid-shift safe drops and drawer reconciliations', 'FINANCIAL', 'FLAG', 'ACTIVE'),
  ('f1111111-0000-0000-0000-000000000006', 'INVENTORY', 'Live Stock Tracking', 'Real-time multi-location inventory deduction', 'INVENTORY', 'FLAG', 'ACTIVE')
ON CONFLICT (feature_key) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category, updated_at = NOW();

-- Seed Permissions
INSERT INTO public.permissions (id, feature_id, permission_key, name, description, status)
VALUES
  ('p1111111-0000-0000-0000-000000000001', 'f1111111-0000-0000-0000-000000000001', 'ORDERS_CREATE', 'Create Orders', 'Create new POS cart and ring items', 'ACTIVE'),
  ('p1111111-0000-0000-0000-000000000002', 'f1111111-0000-0000-0000-000000000002', 'REFUNDS_PROCESS', 'Process Refunds', 'Issue cash or card refunds', 'ACTIVE'),
  ('p1111111-0000-0000-0000-000000000003', 'f1111111-0000-0000-0000-000000000003', 'KDS_VIEW', 'View KDS', 'View kitchen queue and bump tickets', 'ACTIVE'),
  ('p1111111-0000-0000-0000-000000000004', 'f1111111-0000-0000-0000-000000000004', 'LOYALTY_APPLY', 'Apply Loyalty Points', 'Look up customers and apply points', 'ACTIVE'),
  ('p1111111-0000-0000-0000-000000000005', 'f1111111-0000-0000-0000-000000000005', 'CASH_SAFE_DROP', 'Perform Safe Drop', 'Transfer cash from drawer to safe', 'ACTIVE')
ON CONFLICT (permission_key) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW();

-- Seed Role Templates
INSERT INTO public.role_templates (id, role_code, name, description, scope_type, status)
VALUES
  ('r1111111-0000-0000-0000-000000000001', 'CASHIER', 'POS Cashier', 'Point of sale order ringing, payments, and receipt printing', 'STORE', 'ACTIVE'),
  ('r1111111-0000-0000-0000-000000000002', 'STORE_MANAGER', 'Store Manager', 'Full store operational control, shift closing, safe drops, and refunds', 'STORE', 'ACTIVE'),
  ('r1111111-0000-0000-0000-000000000003', 'KITCHEN_STAFF', 'Kitchen Staff', 'Kitchen display system viewer and ticket status manager', 'STORE', 'ACTIVE'),
  ('r1111111-0000-0000-0000-000000000004', 'MERCHANT_ADMIN', 'Merchant Administrator', 'Enterprise tenant owner with full access across all merchant stores', 'MERCHANT', 'ACTIVE')
ON CONFLICT (role_code) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, scope_type = EXCLUDED.scope_type, updated_at = NOW();

-- Seed Commercial Plans
INSERT INTO public.plans (id, plan_code, name, description, billing_model, base_price, currency, billing_cycle, status)
VALUES
  ('b1111111-0000-0000-0000-000000000001', 'STARTER', 'Starter Plan', 'Essential cloud POS for single-location small retailers', 'FLAT', 29.00, 'USD', 'MONTHLY', 'ACTIVE'),
  ('b1111111-0000-0000-0000-000000000002', 'PRO', 'Professional Plan', 'Advanced multi-terminal POS with KDS and delivery aggregator sync', 'PER_STORE', 79.00, 'USD', 'MONTHLY', 'ACTIVE'),
  ('b1111111-0000-0000-0000-000000000003', 'ENTERPRISE', 'Enterprise Suite', 'Unlimited stores, custom roles, API integrations, and 24/7 SLA', 'CUSTOM', 199.00, 'USD', 'MONTHLY', 'ACTIVE')
ON CONFLICT (plan_code) DO UPDATE
SET name = EXCLUDED.name, base_price = EXCLUDED.base_price, currency = EXCLUDED.currency, billing_cycle = EXCLUDED.billing_cycle, updated_at = NOW();
