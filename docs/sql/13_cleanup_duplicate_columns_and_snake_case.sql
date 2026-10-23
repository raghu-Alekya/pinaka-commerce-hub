-- ==============================================================================
-- Migration: 13_cleanup_duplicate_columns_and_snake_case.sql
-- Description:
--   1. Devices: Drops obsolete camelCase columns and old device_activation_code.
--   2. Merchants: Consolidates identity columns (keeping merchant_id as the primary
--      business identifier and id as the UUID PK; safely dropping duplicate/redundant
--      merchant-code and merchantCode columns).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Devices Table Cleanup
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.devices
  DROP COLUMN IF EXISTS "deviceCode",
  DROP COLUMN IF EXISTS "deviceName",
  DROP COLUMN IF EXISTS "deviceType",
  DROP COLUMN IF EXISTS "merchantId",
  DROP COLUMN IF EXISTS "merchantName",
  DROP COLUMN IF EXISTS "serialNumber",
  DROP COLUMN IF EXISTS "createdAt",
  DROP COLUMN IF EXISTS "updatedAt",
  DROP COLUMN IF EXISTS device_activation_code;

-- Ensure device_code has a unique constraint/index
CREATE UNIQUE INDEX IF NOT EXISTS devices_device_code_idx
  ON public.devices (device_code);

-- ------------------------------------------------------------------------------
-- 2. Merchants Table Cleanup & Identity Normalization
-- ------------------------------------------------------------------------------
DO $migration$
BEGIN
  -- Backfill merchant_id from merchant_code if merchant_id is ever null
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'merchant_code'
  ) THEN
    UPDATE public.merchants
    SET merchant_id = merchant_code
    WHERE merchant_id IS NULL AND merchant_code IS NOT NULL;
  END IF;

  -- Ensure PK is on id (UUID) if not already
  -- Drop redundant merchant-code / merchantCode columns
  ALTER TABLE public.merchants DROP COLUMN IF EXISTS "merchant-code";
  ALTER TABLE public.merchants DROP COLUMN IF EXISTS "merchantCode";
END;
$migration$;

COMMIT;