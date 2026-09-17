import { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ADDON_BILLING_TYPES } from './feature-access';

async function columns(manager: EntityManager, table: string) {
  const rows: Array<{ column_name: string }> = await manager.query(
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
  return snake;
}

export async function syncStorePlanAndAddons(manager: EntityManager, input: {
  merchantId: string;
  subscriptionId: string;
  storeId: string;
  licensed?: boolean;
  addons?: Array<{ featureId: string; billingType?: string; isEnabled?: boolean }>;
  features?: string[];
}) {
  if (input.licensed === true) {
    const cols = await columns(manager, 'subscription_stores');
    if (cols.size) {
      const merchant = pick(cols, 'merchant_id', 'merchantId');
      const subscription = pick(cols, 'subscription_id', 'subscriptionId');
      const store = pick(cols, 'store_id', 'storeId');
      const status = cols.has('status') ? 'status' : undefined;
      const existing = await manager.query(
        `SELECT 1 FROM public.subscription_stores WHERE ${quote(subscription)} = $1 AND ${quote(store)} = $2`,
        [input.subscriptionId, input.storeId],
      );
      if (!existing.length) {
        const fields = [merchant, subscription, store];
        const values: unknown[] = [input.merchantId, input.subscriptionId, input.storeId];
        if (cols.has('id')) { fields.unshift('id'); values.unshift(randomUUID()); }
        if (status) { fields.push(status); values.push('ACTIVE'); }
        await manager.query(
          `INSERT INTO public.subscription_stores (${fields.map(quote).join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})`,
          values,
        );
      }
    }
  }

  const extras = [
    ...(input.addons || []),
    ...(input.features || []).map(featureId => ({ featureId, billingType: 'ADDON_MONTHLY' as const, isEnabled: true })),
  ];
  if (!extras.length) return;
  const cols = await columns(manager, 'store_entitlements');
  if (!cols.size) return;
  const store = pick(cols, 'store_id', 'storeId');
  const feature = pick(cols, 'feature_id', 'featureId');
  const enabled = pick(cols, 'enabled', 'isEnabled');
  const billing = cols.has('billing_type') || cols.has('billingType') ? pick(cols, 'billing_type', 'billingType') : undefined;
  const source = cols.has('source') ? 'source' : undefined;
  for (const extra of extras) {
    const billingType = extra.billingType && ADDON_BILLING_TYPES.includes(extra.billingType as typeof ADDON_BILLING_TYPES[number])
      ? extra.billingType : 'ADDON_MONTHLY';
    const isEnabled = extra.isEnabled !== false;
    const found = await manager.query(
      `SELECT 1 FROM public.store_entitlements WHERE ${quote(store)} = $1 AND ${quote(feature)} = $2`,
      [input.storeId, extra.featureId],
    );
    if (found.length) {
      const sets = [`${quote(enabled)} = $3`];
      const values: unknown[] = [input.storeId, extra.featureId, isEnabled];
      if (billing) { sets.push(`${quote(billing)} = $${values.length + 1}`); values.push(billingType); }
      await manager.query(
        `UPDATE public.store_entitlements SET ${sets.join(', ')} WHERE ${quote(store)} = $1 AND ${quote(feature)} = $2`,
        values,
      );
      continue;
    }
    const fields = [store, feature, enabled];
    const values: unknown[] = [input.storeId, extra.featureId, isEnabled];
    if (cols.has('id')) { fields.unshift('id'); values.unshift(randomUUID()); }
    if (billing) { fields.push(billing); values.push(billingType); }
    if (source) { fields.push(source); values.push(billingType); }
    await manager.query(
      `INSERT INTO public.store_entitlements (${fields.map(quote).join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})`,
      values,
    );
  }
}
