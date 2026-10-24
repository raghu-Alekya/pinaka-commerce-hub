-- Manual companion to the startup migration in libs/database.
-- Safe to run more than once. Application startup applies the same changes.

BEGIN;

-- Devices: drop the camelCase code and the retired activation column.
ALTER TABLE IF EXISTS public.devices
  DROP COLUMN IF EXISTS "deviceCode",
  DROP COLUMN IF EXISTS device_activation_code;

-- Merchants: merchant_code is the business identifier (MCH-0001, MCH-0002).
-- merchants.merchant_id is removed. Other tables keep merchant_id as the merchant UUID.
ALTER TABLE IF EXISTS public.merchants
  DROP COLUMN IF EXISTS "merchant-code",
  DROP COLUMN IF EXISTS "merchantCode",
  DROP COLUMN IF EXISTS merchant_id;

-- Repair phone numbers whose country code was stored twice (+9191..., +11... for US/CA).
UPDATE public.merchants
   SET phone = substring(regexp_replace(phone, '\D', '', 'g') from 5)
 WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') ~ '^9191[6-9][0-9]{9}$';

UPDATE public.merchants
   SET alternate_phone = substring(regexp_replace(alternate_phone, '\D', '', 'g') from 5)
 WHERE regexp_replace(COALESCE(alternate_phone, ''), '\D', '', 'g') ~ '^9191[6-9][0-9]{9}$';

UPDATE public.merchants
   SET phone = substring(regexp_replace(phone, '\D', '', 'g') from 3)
 WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') ~ '^11[2-9][0-9]{9}$'
   AND upper(COALESCE(country, '')) IN ('', 'US', 'USA', 'CA', 'CANADA', 'UNITED STATES', 'UNITED STATES OF AMERICA');

UPDATE public.merchants
   SET alternate_phone = substring(regexp_replace(alternate_phone, '\D', '', 'g') from 3)
 WHERE regexp_replace(COALESCE(alternate_phone, ''), '\D', '', 'g') ~ '^11[2-9][0-9]{9}$'
   AND upper(COALESCE(country, '')) IN ('', 'US', 'USA', 'CA', 'CANADA', 'UNITED STATES', 'UNITED STATES OF AMERICA');

-- Subscriptions: keep subscription_code. Drop the camelCase copies.
ALTER TABLE IF EXISTS public.subscriptions
  DROP COLUMN IF EXISTS "subscriptionId",
  DROP COLUMN IF EXISTS "subscriptionCode";

-- Vendors / tendors.
ALTER TABLE IF EXISTS public.vendors DROP COLUMN IF EXISTS "vendorCode";
ALTER TABLE IF EXISTS public.tendors DROP COLUMN IF EXISTS "tendorCode";
ALTER TABLE IF EXISTS public.tendors DROP COLUMN IF EXISTS store_type_id;

-- discounts is a write-only mirror of store_discounts. Drop it when nothing references it.
DO $drop_discounts$
BEGIN
  IF to_regclass('public.discounts') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE confrelid = 'public.discounts'::regclass AND contype = 'f'
     ) THEN
    DROP TABLE public.discounts;
  END IF;
END;
$drop_discounts$;

-- Retained on purpose:
--   permissions: still joined by role_permissions, employee access, and relationship APIs.
--   feature_permissions is a separate catalog (permission_code + permission_type).
--   store_role_features: empty, but it is the store-scoped role feature table registered
--   with the merchant data source. Current RBAC does not read it; dropping it would only
--   remove that override slot, and startup would recreate it from the entity.
--   subscription_plans: plan catalog, not store configuration.
-- Store configuration now lives only in store_pos_configurations.
-- The old per-setting tables are dropped below. Operational tables
-- (pos_safe_transactions, pos_safe_drop_transactions, pos_shifts,
-- pos_employee_attendance, pos_data_sync_*) stay.

DROP TABLE IF EXISTS public.pos_tax_classes;
DROP TABLE IF EXISTS public.pos_cashback_tiers;
DROP TABLE IF EXISTS public.pos_service_charge_tiers;
DROP TABLE IF EXISTS public.pos_cash_denomination_items;
DROP TABLE IF EXISTS public.pos_cash_denomination_item;
DROP TABLE IF EXISTS public.pos_cash_registers;
DROP TABLE IF EXISTS public.pos_safe_drop_denominations;
DROP TABLE IF EXISTS public.pos_safe_drop_tubes;
DROP TABLE IF EXISTS public.pos_terminal_mappings;
DROP TABLE IF EXISTS public.pos_card_payment_settings;
DROP TABLE IF EXISTS public.pos_cash_denomination_settings;
DROP TABLE IF EXISTS public.pos_cash_register_settings;
DROP TABLE IF EXISTS public.pos_cashback_settings;
DROP TABLE IF EXISTS public.pos_currency_tax_settings;
DROP TABLE IF EXISTS public.pos_opening_balance_settings;
DROP TABLE IF EXISTS public.pos_safe_drop_settings;
DROP TABLE IF EXISTS public.pos_service_charge_settings;
DROP TABLE IF EXISTS public.pos_terminal_mapping_settings;
DROP TABLE IF EXISTS public.pos_configs;

COMMIT;
