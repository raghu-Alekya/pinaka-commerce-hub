import { DataSource } from 'typeorm';
import { ensureMerchantIdentitySchema } from './merchant-identity.schema';

/** Additive onboarding fields and history links. Subscription columns stay intact. */
export async function ensureMerchantCrudSchema(db: DataSource): Promise<void> {
  await ensureMerchantIdentitySchema(db);
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');
    const columns = new Set((await manager.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='merchants'`)).map((row: {column_name: string}) => row.column_name));
    if (!columns.has('merchantCode')) throw new Error('Merchant CRUD requires merchantCode');
    await manager.query(`ALTER TABLE public.merchants
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
    if (!columns.has('merchantName')) await manager.query('UPDATE public.merchants SET "merchantName"="ownerName"');
    if (!columns.has('businessDisplayName')) await manager.query('UPDATE public.merchants SET "businessDisplayName"="businessName"');
    if (!columns.has('addressLine1')) await manager.query('UPDATE public.merchants SET "addressLine1"="businessAddress"');
    const subscriptionColumns: Record<string,string> = {planId:'planId',billingCycle:'billingCycle',startDate:'startDate',renewalDate:'renewalDate',agreementPrice:'price'};
    for (const [target, source] of Object.entries(subscriptionColumns)) if (!columns.has(target)) {
      await manager.query(`UPDATE public.merchants m SET "${target}"=(SELECT s."${source}" FROM public.subscriptions s
        WHERE s."merchantId"=m."merchantId" ORDER BY (s.status='ACTIVE') DESC,s."createdAt" DESC,s.id DESC LIMIT 1)`);
    }
    if (!columns.has('roleIds')) await manager.query(`UPDATE public.merchants m SET "roleIds"=COALESCE((
      SELECT jsonb_agg(DISTINCT r.source_role_template_id) FROM public.merchant_role_templates r
      WHERE r.merchant_id=m.id AND r.status='ACTIVE' AND r.source_role_template_id IS NOT NULL),'[]'::jsonb)`);
    const [legacy] = await manager.query(`SELECT to_regclass('public.merchant_store_types') AS store_types,
      to_regclass('public.subscription_billing_details') AS billing`);
    if (legacy.store_types && !columns.has('storeTypeId')) await manager.query(`UPDATE public.merchants m SET "storeTypeId"=t."storeTypeId"
      FROM public.merchant_store_types t WHERE t.merchant_code=m."merchantCode"`);
    if (legacy.billing) for (const field of ['tax','totalDueToday','paymentMethod']) if (!columns.has(field)) {
      await manager.query(`UPDATE public.merchants m SET "${field}"=(SELECT b."${field}" FROM public.subscriptions s
        JOIN public.subscription_billing_details b ON b."subscriptionId"=s.id WHERE s."merchantId"=m."merchantId"
        ORDER BY (s.status='ACTIVE') DESC,s."createdAt" DESC,s.id DESC LIMIT 1)`);
    }
    // Each version retains a unique row UUID and code. References to the original
    // business identity remain valid; no existing foreign keys need to be moved.
    await manager.query(`CREATE TABLE IF NOT EXISTS public.merchant_record_versions (
      record_code varchar(100) PRIMARY KEY REFERENCES public.merchants("merchantCode"),
      merchant_code varchar(100) NOT NULL REFERENCES public.merchants("merchantCode"),
      version bigint GENERATED ALWAYS AS IDENTITY UNIQUE
    )`);
    await manager.query(`CREATE INDEX IF NOT EXISTS merchant_versions_identity_idx ON public.merchant_record_versions(merchant_code,version DESC)`);
    await manager.query(`INSERT INTO public.merchant_record_versions(record_code,merchant_code)
      SELECT "merchantCode","merchantCode" FROM public.merchants ON CONFLICT(record_code) DO NOTHING`);
    // Historical versions must be allowed to retain the same email address.
    const constraints = await manager.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.merchants'::regclass
      AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.merchants'::regclass AND attname='email')]::smallint[]`);
    for (const constraint of constraints) await manager.query(`ALTER TABLE public.merchants DROP CONSTRAINT "${constraint.conname.replace(/"/g,'""')}"`);
    await manager.query(`CREATE UNIQUE INDEX IF NOT EXISTS merchants_active_email_uq ON public.merchants(email) WHERE status='ACTIVE'`);
  });
}
