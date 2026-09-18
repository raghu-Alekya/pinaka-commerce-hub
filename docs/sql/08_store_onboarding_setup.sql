-- Additive migration for store location schedules and onboarding selections.
-- These values do not grant permissions, activate subscriptions, or register devices.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS "onboardingSetup" jsonb NOT NULL DEFAULT '{}'::jsonb;
