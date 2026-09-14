CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  "merchantId" varchar(100) NOT NULL REFERENCES merchants(id),
  "storeId" varchar(100) NOT NULL REFERENCES stores(id),
  "serialNumber" varchar(100) NOT NULL UNIQUE,
  details jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_store_idx ON devices ("storeId");
