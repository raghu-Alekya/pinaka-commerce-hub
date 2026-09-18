import { DataSource } from 'typeorm';

export async function ensureOnboardingSchema(db: DataSource): Promise<void> {
  await db.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS "onboardingSetup" jsonb NOT NULL DEFAULT '{}'::jsonb`);
}
