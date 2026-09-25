import { DataSource } from 'typeorm';
import { ensureMerchantIdentitySchema } from './merchant-identity.schema';

export async function ensureMerchantCrudSchema(db: DataSource): Promise<void> {
  try {
    await ensureMerchantIdentitySchema(db);
    await db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');
      const columns = new Set((await manager.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='merchants'`)).map((row: {column_name: string}) => row.column_name));

      await manager.query(`ALTER TABLE public.merchants
        ADD COLUMN IF NOT EXISTS "merchantCode" varchar(100),
        ADD COLUMN IF NOT EXISTS "merchantId" varchar(100),
        ADD COLUMN IF NOT EXISTS "merchantName" varchar(150),
        ADD COLUMN IF NOT EXISTS "businessDisplayName" varchar(255),
        ADD COLUMN IF NOT EXISTS "addressLine1" text,
        ADD COLUMN IF NOT EXISTS "addressLine2" text,
        ADD COLUMN IF NOT EXISTS "planId" uuid,
        ADD COLUMN IF NOT EXISTS "billingCycle" varchar(20),
        ADD COLUMN IF NOT EXISTS "startDate" date,
        ADD COLUMN IF NOT EXISTS "renewalDate" date,
        ADD COLUMN IF NOT EXISTS "agreementPrice" numeric(10,2),
        ADD COLUMN IF NOT EXISTS tax numeric(12,2),
        ADD COLUMN IF NOT EXISTS "totalDueToday" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "paymentMethod" varchar(50),
        ADD COLUMN IF NOT EXISTS "storeTypeId" uuid,
        ADD COLUMN IF NOT EXISTS "roleIds" jsonb NOT NULL DEFAULT '[]'::jsonb`);

      if (columns.has('ownerName')) {
        await manager.query('UPDATE public.merchants SET "merchantName"=COALESCE("merchantName", "ownerName") WHERE "merchantName" IS NULL');
      }
      if (columns.has('businessName')) {
        await manager.query('UPDATE public.merchants SET "businessDisplayName"=COALESCE("businessDisplayName", "businessName") WHERE "businessDisplayName" IS NULL');
      }
      if (columns.has('businessAddress')) {
        await manager.query('UPDATE public.merchants SET "addressLine1"=COALESCE("addressLine1", "businessAddress") WHERE "addressLine1" IS NULL');
      }

      try {
        await manager.query(`CREATE TABLE IF NOT EXISTS public.merchant_record_versions (
          record_code varchar(100) PRIMARY KEY,
          version bigint GENERATED ALWAYS AS IDENTITY UNIQUE
        )`);
      } catch {}
    });
  } catch (error) {
    console.warn('ensureMerchantCrudSchema notice:', error);
  }
}
