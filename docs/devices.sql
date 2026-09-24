-- Device fields used by the Devices screen are stored as regular columns so
-- they can be queried and indexed without reading the details JSON document.
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  "deviceName" varchar(255) NOT NULL,
  "deviceCode" varchar(100) NOT NULL,
  "merchantId" varchar(100) NOT NULL,
  "merchantName" varchar(255) NOT NULL,
  "storeId" varchar(100) REFERENCES stores(legacy_store_id),
  "storeName" varchar(255),
  "serialNumber" varchar(100) NOT NULL UNIQUE,
  "deviceType" varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'Active',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Upgrade databases created by earlier versions of the device schema.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceName" varchar(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceCode" varchar(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "merchantName" varchar(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "storeName" varchar(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deviceType" varchar(100);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'Active';

-- A device may belong to a merchant without being assigned to a store.
ALTER TABLE devices ALTER COLUMN "storeId" DROP NOT NULL;
ALTER TABLE devices ALTER COLUMN "storeName" DROP NOT NULL;

-- Preserve existing values stored in details and fill labels from their parents.
UPDATE devices d
SET "deviceName" = COALESCE(NULLIF(d.details ->> 'deviceName', ''), 'Unnamed device'),
    "deviceCode" = COALESCE(NULLIF(d."deviceCode", ''), 'DEV-' || LEFT(REPLACE(d.id::text, '-', ''), 12)),
    "merchantName" = COALESCE((SELECT m."businessName" FROM merchants m WHERE m."merchantId" = d."merchantId" OR m."merchantCode" = d."merchantId" OR m.id::text = d."merchantId"), d."merchantId"),
    "storeName" = COALESCE((SELECT s."storeName" FROM stores s WHERE s.legacy_store_id = d."storeId"), d."storeId"),
    "deviceType" = COALESCE(NULLIF(d.details ->> 'deviceType', ''), 'Other'),
    status = COALESCE(NULLIF(d.details ->> 'status', ''), d.status, 'Active');

ALTER TABLE devices ALTER COLUMN "deviceName" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "deviceCode" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "merchantName" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN "deviceType" SET NOT NULL;
ALTER TABLE devices ALTER COLUMN status SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS devices_device_code_unique_idx ON devices (lower("deviceCode"));
CREATE INDEX IF NOT EXISTS devices_store_idx ON devices ("storeId");
