-- Run against the merchant database before using Quarterly plans.
-- Supports the legacy snake_case and aligned camelCase plans schema.
BEGIN;
DO $$
DECLARE cycle_column text;
BEGIN
  SELECT column_name INTO cycle_column FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans'
      AND column_name IN ('billingCycle', 'billing_cycle')
    ORDER BY CASE WHEN column_name = 'billingCycle' THEN 0 ELSE 1 END LIMIT 1;
  IF cycle_column IS NULL THEN
    RAISE EXCEPTION 'Install the plans schema before this migration';
  END IF;
  ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_billing_cycle_valid;
  EXECUTE format('ALTER TABLE public.plans ADD CONSTRAINT plans_billing_cycle_valid CHECK (%I IN (''MONTHLY'', ''QUARTERLY'', ''ANNUAL''))', cycle_column);
END $$;
COMMIT;
