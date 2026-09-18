-- Additive vertical and add-on columns for features/plans and store entitlement billing.
ALTER TABLE IF EXISTS public.features
    ADD COLUMN IF NOT EXISTS store_type VARCHAR(20) NOT NULL DEFAULT 'BOTH',
    ADD COLUMN IF NOT EXISTS is_addon_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS addon_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.plans
    ADD COLUMN IF NOT EXISTS store_type VARCHAR(20) NOT NULL DEFAULT 'BOTH';

ALTER TABLE IF EXISTS public.store_entitlements
    ADD COLUMN IF NOT EXISTS billing_type VARCHAR(30);
