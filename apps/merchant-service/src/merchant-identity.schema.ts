import { DataSource } from 'typeorm';

/** Stable business identity is separate from each version's unique UUID/code. */
export async function ensureMerchantIdentitySchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 31)');
    const columns = new Set((await manager.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='merchants'`)).map((row: {column_name: string}) => row.column_name));
    if (columns.has('merchant_code') && !columns.has('merchantCode')) {
      await manager.query('ALTER TABLE public.merchants RENAME COLUMN merchant_code TO "merchantCode"');
    } else if (!columns.has('merchantCode') || columns.has('merchant_code')) {
      throw new Error('Expected one merchant code column; refusing an ambiguous identity migration');
    }
    await manager.query('ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS "merchantId" varchar(100)');
    const [versions] = await manager.query(`SELECT to_regclass('public.merchant_record_versions') AS present`);
    if (versions.present) await manager.query(`UPDATE public.merchants m SET "merchantId"=v.merchant_code
      FROM public.merchant_record_versions v WHERE v.record_code=m."merchantCode" AND m."merchantId" IS NULL`);
    await manager.query('UPDATE public.merchants SET "merchantId"="merchantCode" WHERE "merchantId" IS NULL');
    await manager.query('ALTER TABLE public.merchants ALTER COLUMN "merchantId" SET NOT NULL');
    await manager.query('CREATE INDEX IF NOT EXISTS merchants_identity_idx ON public.merchants("merchantId")');
    await manager.query(`CREATE UNIQUE INDEX IF NOT EXISTS merchants_active_identity_uq ON public.merchants("merchantId") WHERE status='ACTIVE'`);
    // Retain legacy repository inserts that generate only a merchant code.
    await manager.query(`CREATE OR REPLACE FUNCTION public.pch_set_merchant_identity() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF TG_OP='UPDATE' AND NEW."merchantId" IS DISTINCT FROM OLD."merchantId" THEN
          RAISE EXCEPTION 'merchantId cannot be changed' USING ERRCODE='23514';
        END IF;
        IF NEW."merchantId" IS NULL THEN NEW."merchantId":='MER-' || gen_random_uuid()::text; END IF;
        RETURN NEW;
      END $body$`);
    await manager.query('DROP TRIGGER IF EXISTS pch_merchant_identity ON public.merchants');
    await manager.query(`CREATE TRIGGER pch_merchant_identity BEFORE INSERT OR UPDATE ON public.merchants
      FOR EACH ROW EXECUTE FUNCTION public.pch_set_merchant_identity()`);
    // Promote the existing UUID index to a constraint without removing FK targets.
    await manager.query(`DO $body$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.merchants'::regclass AND conname='merchants_generated_id_uq') THEN
        CREATE UNIQUE INDEX IF NOT EXISTS merchants_generated_id_uq ON public.merchants(id);
        ALTER TABLE public.merchants ADD CONSTRAINT merchants_generated_id_uq UNIQUE USING INDEX merchants_generated_id_uq;
      END IF;
      -- merchantCode already has primary-key uniqueness; no duplicate unique index is needed.
      IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.conrelid='public.merchants'::regclass AND c.contype IN ('p','u') AND cardinality(c.conkey)=1 AND a.attname='merchantCode') THEN
        ALTER TABLE public.merchants ADD CONSTRAINT merchants_code_uq UNIQUE("merchantCode");
      END IF;
    END $body$`);
    // Repair the old equal-ID/code assignment without changing business IDs,
    // row UUIDs, subscription ownership, or UUID-based employee/role references.
    await manager.query(`CREATE TABLE IF NOT EXISTS public.merchant_record_versions (
      record_code varchar(100) PRIMARY KEY REFERENCES public.merchants("merchantCode"),
      merchant_code varchar(100) NOT NULL REFERENCES public.merchants("merchantCode"),
      version bigint GENERATED ALWAYS AS IDENTITY UNIQUE)`);
    await manager.query(`INSERT INTO public.merchant_record_versions(record_code,merchant_code)
      SELECT "merchantCode","merchantCode" FROM public.merchants ON CONFLICT(record_code) DO NOTHING`);
    const references = await manager.query(`SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE k.contype='f' AND k.confrelid='public.merchants'::regclass AND k.confupdtype<>'c'
      AND k.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.merchants'::regclass AND attname='merchantCode')]::smallint[]`);
    const quote = (name: string) => '"' + name.replace(/"/g,'""') + '"';
    for (const reference of references) {
      const table=`${quote(reference.nspname)}.${quote(reference.relname)}`;
      const definition=reference.definition.replace(/ ON UPDATE (?:NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/,'')
        .replace(/(?= (?:NOT )?DEFERRABLE| NOT VALID|$)/,' ON UPDATE CASCADE');
      await manager.query(`ALTER TABLE ${table} DROP CONSTRAINT ${quote(reference.conname)}`);
      await manager.query(`ALTER TABLE ${table} ADD CONSTRAINT ${quote(reference.conname)} ${definition}`);
    }
    await manager.query(`UPDATE public.merchants SET "merchantCode"='MRC-' || gen_random_uuid()::text WHERE "merchantCode"="merchantId"`);
    await manager.query(`DO $body$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.merchants'::regclass AND conname='merchants_distinct_identity_code') THEN
        ALTER TABLE public.merchants ADD CONSTRAINT merchants_distinct_identity_code CHECK ("merchantCode"<>"merchantId");
      END IF;
    END $body$`);
  });
}
