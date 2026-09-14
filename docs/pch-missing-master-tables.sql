-- PCH missing master tables: employees and roles.
-- Reference: PCH_Master_Data_Relationships_UI_Mapping.pdf, section 2.
-- PostgreSQL 13+. SQL file only; no application integration is included.
--
-- Prerequisites, in order:
--   1. Existing merchant-onboarding-postgres.sql schema (public.merchants/stores).
--   2. pch-master-tables.sql (including role_templates and audit trigger function).
--
-- Master inventory:
--   Existing onboarding schema: merchants, stores.
--   First master script: store_types, features, permissions, role_templates, plans.
--   This script: employees, roles.
--
-- merchant_id deliberately uses VARCHAR(100), matching existing merchants.id.
-- New employee and role IDs use UUID, matching the new master catalog.
-- This does not migrate the existing merchant/store columns to the PDF model.
-- Employee store assignments, role permissions and other relationship tables
-- are separate follow-up migrations. There is deliberately no employees.role_id.
-- Run once against the intended application database. Existing target tables
-- cause an error; the transaction prevents a partially applied schema.

BEGIN;

CREATE TABLE public.employees (
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

-- The (merchant_id, id) unique index also supports merchant employee lookups.
CREATE TRIGGER employees_set_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

CREATE TABLE public.roles (
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

CREATE INDEX roles_source_role_template_id_idx
    ON public.roles (source_role_template_id);

CREATE TRIGGER roles_set_updated_at
    BEFORE UPDATE ON public.roles
    FOR EACH ROW EXECUTE FUNCTION public.pch_master_set_updated_at();

COMMENT ON TABLE public.employees IS
    'Merchant workforce master. Store assignments and role grants are maintained separately.';
COMMENT ON COLUMN public.employees.employee_code IS
    'Globally unique employee business code, as specified by the reference model.';
COMMENT ON TABLE public.roles IS
    'Merchant-owned role master. Permissions and employee assignments are separate relationships.';
COMMENT ON COLUMN public.roles.source_role_template_id IS
    'Optional provenance; referencing a template does not automatically copy or grant permissions.';
COMMENT ON COLUMN public.roles.is_custom IS
    'True for a merchant-created/customized role; a customized role may retain its source template.';

COMMIT;
