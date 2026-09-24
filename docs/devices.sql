-- Device fields are stored as queryable columns. Store assignment is not part
-- of the Device record.
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  "deviceName" varchar(255) NOT NULL,
  "deviceCode" varchar(100) NOT NULL,
  "merchantId" varchar(100) NOT NULL,
  "merchantName" varchar(255) NOT NULL,
  "serialNumber" varchar(100) NOT NULL UNIQUE,
  "deviceType" varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'Active',
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Upgrade databases created by earlier versions of the device schema.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceName" varchar(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceCode" varchar(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "merchantName" varchar(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceType" varchar(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'Active';

-- Remove store fields from databases created with the earlier Device schema.
DROP INDEX IF EXISTS devices_store_idx;
ALTER TABLE devices DROP COLUMN IF EXISTS "storeId";
ALTER TABLE devices DROP COLUMN IF EXISTS "storeName";

-- Preserve the queryable values from older details JSON and fill merchant names.
UPDATE devices d
SET "deviceName" = COALESCE(NULLIF(to_jsonb(d)->'details'->>'deviceName', ''), NULLIF(d."deviceName", ''), 'Unnamed device'),
    "deviceCode" = COALESCE(NULLIF(d."deviceCode", ''), 'DEV-' || LEFT(REPLACE(d.id::text, '-', ''), 12)),
    "merchantName" = COALESCE((SELECT m."businessName" FROM merchants m WHERE m."merchantId" = d."merchantId" OR m."merchantCode" = d."merchantId" OR m.id::text = d."merchantId"), d."merchantId"),
    "deviceType" = COALESCE(NULLIF(to_jsonb(d)->'details'->>'deviceType', ''), NULLIF(d."deviceType", ''), 'Other'),
    status = COALESCE(NULLIF(to_jsonb(d)->'details'->>'status', ''), d.status, 'Active');

ALTER TABLE devices ALTER COLUMN "deviceName" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "deviceCode" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "merchantName" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "deviceType" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN status SET NOT NULL;
ALTER TABLE devices DROP COLUMN IF EXISTS details;

CREATE UNIQUE INDEX IF NOT EXISTS devices_device_code_unique_idx ON devices (lower("deviceCode"));
