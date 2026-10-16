import { DataSource } from 'typeorm';

async function columns(db: DataSource, table: string) {
  const rows: Array<{ column_name: string }> = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return new Set(rows.map(row => row.column_name));
}

function quote(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function pick(existing: Set<string>, snake: string, camel: string) {
  if (existing.has(snake)) return snake;
  if (existing.has(camel)) return camel;
  if ([...existing].some(name => /[A-Z]/.test(name))) return camel;
  return snake;
}

async function addColumn(db: DataSource, table: string, existing: Set<string>, snake: string, camel: string, sqlType: string) {
  if (existing.has(snake) || existing.has(camel)) return;
  const name = pick(existing, snake, camel);
  await db.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${quote(name)} ${sqlType}`);
  existing.add(name);
}

export async function ensureFeaturePlanCatalogSchema(db: DataSource): Promise<void> {
  const features = await columns(db, 'features');
  if (features.size) {
    await addColumn(db, 'features', features, 'store_type', 'storeType', `VARCHAR(20) NOT NULL DEFAULT 'BOTH'`);
    await addColumn(db, 'features', features, 'is_addon_eligible', 'isAddonEligible', 'BOOLEAN NOT NULL DEFAULT TRUE');
    await addColumn(db, 'features', features, 'addon_price', 'addonPrice', 'NUMERIC(12,2) NOT NULL DEFAULT 0');
  }
  const plans = await columns(db, 'plans');
  if (plans.size) {
    await addColumn(db, 'plans', plans, 'store_type', 'storeType', `VARCHAR(20) NOT NULL DEFAULT 'BOTH'`);
  }
  const entitlements = await columns(db, 'store_entitlements');
  if (entitlements.size) {
    await addColumn(db, 'store_entitlements', entitlements, 'billing_type', 'billingType', 'VARCHAR(30)');
  }
}
