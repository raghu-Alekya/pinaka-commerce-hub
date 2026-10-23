-- Device schema documentation (current snake_case standard).
-- Applied automatically by ensureMerchantDevicesSchema() on service startup.
-- All camelCase legacy columns (deviceCode, merchantId, etc.) and the old
-- device_activation_code column have been removed; snake_case equivalents are
-- the only live columns.

CREATE TABLE IF NOT EXISTS devices (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name         varchar(255) NOT NULL,
  device_code         varchar(100) NOT NULL UNIQUE,
  device_id           text,
  device_active_code  varchar(100),
  authorization_code  varchar(100),
  merchant_id         varchar(100) NOT NULL,
  merchant_name       varchar(255) NOT NULL,
  serial_number       varchar(100) UNIQUE,
  notes               text,
  device_type         varchar(100) NOT NULL,
  status              varchar(20)  NOT NULL DEFAULT 'Active',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- Unique partial indexes for activation codes.
CREATE UNIQUE INDEX IF NOT EXISTS devices_device_active_code_uidx
  ON devices (device_active_code)
  WHERE device_active_code IS NOT NULL AND device_active_code <> '';

CREATE UNIQUE INDEX IF NOT EXISTS devices_authorization_code_uidx
  ON devices (authorization_code)
  WHERE authorization_code IS NOT NULL AND authorization_code <> '';

-- Lookup index for merchant-scoped device queries.
CREATE INDEX IF NOT EXISTS devices_merchant_id_idx
  ON devices (merchant_id);
