import { DataSource } from 'typeorm';

/** One opening-balance row per store. */
export async function ensurePosOpeningBalanceSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 48)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_opening_balance_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        "requireOpeningBalance" boolean NOT NULL DEFAULT true,
        "defaultOpeningAmount" numeric(12,4) NOT NULL DEFAULT 0,
        "managerApprovalRequired" boolean NOT NULL DEFAULT true,
        "varianceTolerance" numeric(12,4) NOT NULL DEFAULT 0,
        "allowCashierOverride" boolean NOT NULL DEFAULT false,
        "countByDenomination" boolean NOT NULL DEFAULT true,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_opening_balance_settings_store_uq UNIQUE ("storeId"),
        CONSTRAINT pos_opening_balance_settings_amount_chk CHECK ("defaultOpeningAmount" >= 0),
        CONSTRAINT pos_opening_balance_settings_variance_chk CHECK ("varianceTolerance" >= 0)
      )
    `);
  });
}
