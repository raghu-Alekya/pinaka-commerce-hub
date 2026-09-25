import { DataSource } from 'typeorm';

export async function ensureVendorTendorSchema(db: DataSource): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.merchant_vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id UUID NOT NULL,
      vendor_id UUID NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT merchant_vendors_merchant_vendor_uidx UNIQUE (merchant_id, vendor_id)
    );
    CREATE INDEX IF NOT EXISTS pch_merchant_vendors_vendor ON public.merchant_vendors(vendor_id);
    CREATE INDEX IF NOT EXISTS pch_merchant_vendors_merchant ON public.merchant_vendors(merchant_id);
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "vendorName" VARCHAR(150) NOT NULL,
      "vendorType" VARCHAR(20) NOT NULL,
      "vendorCode" VARCHAR(50),
      "contactPerson" VARCHAR(150),
      phone VARCHAR(30),
      email VARCHAR(150),
      "productCategory" VARCHAR(150),
      address TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deletedAt" TIMESTAMPTZ,
      CONSTRAINT vendors_type_valid CHECK ("vendorType" IN ('ORGANIZER', 'SUPPLIER')),
      CONSTRAINT vendors_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
    )
  `);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
  await db.query(`ALTER TABLE public.vendors DROP COLUMN IF EXISTS address`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "addressLine1" VARCHAR(255)`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "addressLine2" VARCHAR(255)`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "city" VARCHAR(100)`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "state" VARCHAR(50)`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "zipCode" VARCHAR(20)`);
  await db.query(`ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS "country" VARCHAR(100)`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS vendors_vendor_code_active_uidx
    ON public.vendors ("vendorCode")
    WHERE "deletedAt" IS NULL AND "vendorCode" IS NOT NULL AND "vendorCode" <> ''
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.tendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "tendorCode" VARCHAR(50) NOT NULL,
      "tendorName" VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deletedAt" TIMESTAMPTZ,
      CONSTRAINT tendors_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
    )
  `);
  await db.query(`ALTER TABLE public.tendors ADD COLUMN IF NOT EXISTS "tendorCode" VARCHAR(50)`);
  await db.query(`
    UPDATE public.tendors
    SET "tendorCode" = 'T' || REPLACE(id::text, '-', '')
    WHERE "tendorCode" IS NULL OR "tendorCode" = ''
  `);
  await db.query(`ALTER TABLE public.tendors ALTER COLUMN "tendorCode" SET NOT NULL`);
  await db.query(`
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
      )
  `);
  await db.query(`
    UPDATE public.tendors AS duplicate
    SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE duplicate."deletedAt" IS NULL
      AND duplicate."tendorCode" IS NOT NULL
      AND duplicate."tendorCode" <> ''
      AND duplicate.id NOT IN (
        SELECT kept.id FROM (
          SELECT DISTINCT ON (LOWER("tendorCode")) id
          FROM public.tendors
          WHERE "deletedAt" IS NULL AND "tendorCode" IS NOT NULL AND "tendorCode" <> ''
          ORDER BY LOWER("tendorCode"), "createdAt" ASC, id ASC
        ) AS kept
      )
  `);
  await db.query(`DROP INDEX IF EXISTS public.tendors_name_active_uidx`);
  await db.query(`
    CREATE UNIQUE INDEX tendors_name_active_uidx
    ON public.tendors (LOWER(BTRIM("tendorName")))
    WHERE "deletedAt" IS NULL
  `);
  await db.query(`DROP INDEX IF EXISTS public.tendors_code_active_uidx`);
  await db.query(`
    CREATE UNIQUE INDEX tendors_code_active_uidx
    ON public.tendors (LOWER(BTRIM("tendorCode")))
    WHERE "deletedAt" IS NULL AND "tendorCode" IS NOT NULL AND BTRIM("tendorCode") <> ''
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.merchant_vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id UUID NOT NULL,
      vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT merchant_vendors_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE')),
      CONSTRAINT merchant_vendors_merchant_vendor_uidx UNIQUE (merchant_id, vendor_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS pch_merchant_vendors_vendor ON public.merchant_vendors(vendor_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS pch_merchant_vendors_merchant ON public.merchant_vendors(merchant_id)`);
}
