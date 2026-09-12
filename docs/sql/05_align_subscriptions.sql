-- Align existing subscriptions with the commercial contract model.
-- Preserves text IDs, legacy snapshot columns, and all relationship references.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.subscriptions IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE old_name text; new_name text; constraint_name text; merchant_column smallint;
BEGIN
  FOR old_name,new_name IN SELECT * FROM (VALUES
    ('merchantId','merchant_id'), ('billingCycle','billing_cycle'),
    ('createdAt','created_at'), ('updatedAt','updated_at')
  ) AS names(old_column,new_column) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name=old_name) THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name=new_name) THEN
        RAISE EXCEPTION 'Both subscription columns % and % exist; reconcile before migrating',old_name,new_name;
      END IF;
      EXECUTE format('ALTER TABLE public.subscriptions RENAME COLUMN %I TO %I',old_name,new_name);
    END IF;
  END LOOP;
  SELECT attnum INTO merchant_column FROM pg_attribute WHERE attrelid='public.subscriptions'::regclass AND attname='merchant_id';
  -- Remove only single-column merchant uniqueness, preserving composite FK targets.
  FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass
    AND contype='u' AND conkey=ARRAY[merchant_column] LOOP
    EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT %I',constraint_name);
  END LOOP;
  FOR constraint_name IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid='public.subscriptions'::regclass AND i.indisunique AND NOT i.indisprimary
      AND i.indnkeyatts=1 AND i.indkey[0]=merchant_column
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conindid=i.indexrelid) LOOP
    EXECUTE format('DROP INDEX public.%I',constraint_name);
  END LOOP;
END $migration$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS subscription_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS renewal_date DATE,
  ADD COLUMN IF NOT EXISTS trial_end_date DATE,
  ADD COLUMN IF NOT EXISTS licensed_store_count INTEGER,
  ADD COLUMN IF NOT EXISTS licensed_device_count INTEGER,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

UPDATE public.subscriptions s SET
  subscription_code=COALESCE(s.subscription_code,s.id),
  plan_id=COALESCE(s.plan_id,p.id),
  start_date=COALESCE(s.start_date,s."currentPeriodStart"::date),
  renewal_date=COALESCE(s.renewal_date,s."currentPeriodEnd"::date),
  trial_end_date=COALESCE(s.trial_end_date,CASE WHEN s."trialDays">0 THEN s."currentPeriodStart"::date+s."trialDays" END),
  licensed_store_count=COALESCE(s.licensed_store_count,s."maxStoresAllowed"),
  cancelled_at=COALESCE(s.cancelled_at,CASE WHEN s.status='CANCELLED' THEN s.updated_at END),
  currency=COALESCE(s.currency,p.currency)
FROM public.plans p WHERE s."planCode"=p.plan_code AND s.plan_id IS NULL;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE plan_id IS NULL) THEN
    RAISE EXCEPTION 'Unmapped subscription planCode; create the matching commercial plan before migrating';
  END IF;
END $verify$;

ALTER TABLE public.subscriptions ALTER COLUMN subscription_code SET NOT NULL,
  ALTER COLUMN plan_id SET NOT NULL, ALTER COLUMN currency SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_code_unique ON public.subscriptions(subscription_code);
CREATE INDEX IF NOT EXISTS subscriptions_merchant_history ON public.subscriptions(merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_plan_id ON public.subscriptions(plan_id);
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.subscriptions'::regclass AND conname='subscriptions_commercial_plan_fk') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_commercial_plan_fk FOREIGN KEY(plan_id) REFERENCES public.plans(id);
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_owner_fk FOREIGN KEY(merchant_id) REFERENCES public.merchants(id);
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_contract_limits CHECK(licensed_store_count>=0 AND licensed_device_count>=0);
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_contract_dates CHECK(
      (renewal_date IS NULL OR start_date IS NULL OR renewal_date>start_date) AND
      (trial_end_date IS NULL OR start_date IS NULL OR trial_end_date>=start_date));
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_contract_price CHECK(price>=0 AND price<>'NaN'::numeric);
  END IF;
END $constraints$;

-- Bridge writes from legacy onboarding while keeping plan_id authoritative for new APIs.
CREATE OR REPLACE FUNCTION public.pch_subscription_contract_bridge() RETURNS trigger LANGUAGE plpgsql AS $bridge$
DECLARE selected_plan public.plans%ROWTYPE; legacy_plan boolean;
BEGIN
  legacy_plan := NEW.plan_id IS NULL;
  IF TG_OP='UPDATE' THEN
    legacy_plan := legacy_plan OR (NEW."planCode" IS DISTINCT FROM OLD."planCode" AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id);
  END IF;
  IF legacy_plan THEN
    SELECT * INTO selected_plan FROM public.plans WHERE plan_code=NEW."planCode";
  ELSE
    SELECT * INTO selected_plan FROM public.plans WHERE id=NEW.plan_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commercial plan does not exist' USING ERRCODE='23503'; END IF;
  NEW.plan_id:=selected_plan.id;
  NEW."planCode":=selected_plan.plan_code;
  IF NEW."planName" IS NULL OR legacy_plan THEN NEW."planName":=selected_plan.name; END IF;
  NEW.subscription_code:=COALESCE(NEW.subscription_code,NEW.id);
  NEW.currency:=COALESCE(NEW.currency,selected_plan.currency);
  IF TG_OP='INSERT' THEN
    IF legacy_plan THEN NEW.licensed_store_count:=COALESCE(NEW.licensed_store_count,NEW."maxStoresAllowed"); END IF;
    NEW.start_date:=COALESCE(NEW.start_date,NEW."currentPeriodStart"::date);
    NEW.renewal_date:=COALESCE(NEW.renewal_date,NEW."currentPeriodEnd"::date);
  ELSE
    IF NEW."currentPeriodStart" IS DISTINCT FROM OLD."currentPeriodStart" AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date THEN NEW.start_date:=NEW."currentPeriodStart"::date; END IF;
    IF NEW."currentPeriodEnd" IS DISTINCT FROM OLD."currentPeriodEnd" AND NEW.renewal_date IS NOT DISTINCT FROM OLD.renewal_date THEN NEW.renewal_date:=NEW."currentPeriodEnd"::date; END IF;
    IF NEW."maxStoresAllowed" IS DISTINCT FROM OLD."maxStoresAllowed" AND NEW.licensed_store_count IS NOT DISTINCT FROM OLD.licensed_store_count THEN NEW.licensed_store_count:=NEW."maxStoresAllowed"; END IF;
  END IF;
  IF NEW.status='CANCELLED' THEN NEW.cancelled_at:=COALESCE(NEW.cancelled_at,clock_timestamp()); END IF;
  RETURN NEW;
END $bridge$;
DROP TRIGGER IF EXISTS pch_subscription_contract_bridge ON public.subscriptions;
CREATE TRIGGER pch_subscription_contract_bridge BEFORE INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.pch_subscription_contract_bridge();
COMMIT;
