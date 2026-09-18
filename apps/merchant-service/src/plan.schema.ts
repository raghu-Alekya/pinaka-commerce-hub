import { DataSource } from 'typeorm';
 
/** Additive plan fields used for commercial limits, pricing, and feature bundles. */
export async function ensurePlanSchema(db: DataSource): Promise<void> {
  await db.query(`
    ALTER TABLE public.plans
      ADD COLUMN IF NOT EXISTS store_type varchar(50),
      ADD COLUMN IF NOT EXISTS included_stores integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS included_terminals integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS additional_terminal_price numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS included_employees integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS additional_employee_price numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trial_period integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS effective_from timestamptz,
      ADD COLUMN IF NOT EXISTS included_features text[] NOT NULL DEFAULT '{}'::text[]
  `);
}