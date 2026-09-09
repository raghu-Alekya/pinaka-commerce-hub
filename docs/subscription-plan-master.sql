-- Run in pinaka_delivery_hub. This is the plan catalog, not merchant subscriptions.
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  "planCode" VARCHAR(50) PRIMARY KEY,
  "planName" VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  "maxStoresAllowed" INTEGER NOT NULL CHECK ("maxStoresAllowed" >= 1),
  entitlements JSONB NOT NULL,
  "billingCycle" VARCHAR(20) NOT NULL CHECK ("billingCycle" IN ('MONTHLY', 'ANNUAL', 'FREE_TRIAL')),
  "trialDays" INTEGER NOT NULL DEFAULT 0 CHECK ("trialDays" >= 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
