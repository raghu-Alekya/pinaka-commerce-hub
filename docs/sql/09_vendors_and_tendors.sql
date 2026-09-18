-- Vendor and tendor master tables (camelCase columns to match TypeORM entities).

CREATE TABLE IF NOT EXISTS public.vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "vendorName" VARCHAR(150) NOT NULL,
    "vendorType" VARCHAR(20) NOT NULL,
    "vendorCode" VARCHAR(50),
    "contactPerson" VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(150),
    "productCategory" VARCHAR(150),
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    "zipCode" VARCHAR(20),
    country VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,
    CONSTRAINT vendors_type_valid CHECK ("vendorType" IN ('ORGANIZER', 'SUPPLIER')),
    CONSTRAINT vendors_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS vendors_vendor_code_active_uidx
    ON public.vendors ("vendorCode")
    WHERE "deletedAt" IS NULL AND "vendorCode" IS NOT NULL AND "vendorCode" <> '';

CREATE TABLE IF NOT EXISTS public.tendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tendorName" VARCHAR(150) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,
    CONSTRAINT tendors_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

UPDATE public.tendors AS duplicate
SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE duplicate."deletedAt" IS NULL
  AND duplicate.id NOT IN (
    SELECT kept.id FROM (
      SELECT DISTINCT ON (LOWER("tendorName")) id
      FROM public.tendors
      WHERE "deletedAt" IS NULL
      ORDER BY LOWER("tendorName"), "createdAt" ASC, id ASC
    ) AS kept
  );

CREATE UNIQUE INDEX IF NOT EXISTS tendors_name_active_uidx
    ON public.tendors (LOWER("tendorName"))
    WHERE "deletedAt" IS NULL;
