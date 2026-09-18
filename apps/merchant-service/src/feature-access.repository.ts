import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import { canAccessFeature } from './feature-access';

type Row = Record<string, any>;
const normalize = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));

@Injectable()
export class FeatureAccessRepository implements OnModuleInit, OnModuleDestroy {
  private db!: DataSource;
  async onModuleInit() {
    this.db = new DataSource({ ...postgresConnectionOptions([]), synchronize: false });
    await this.db.initialize();
  }
  async onModuleDestroy() { if (this.db?.isInitialized) await this.db.destroy(); }

  private async read(table: string, field: string, value: string): Promise<Row[]> {
    const snake = field.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
    const rows = await this.db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t
      WHERE COALESCE(to_jsonb(t)->>$1,to_jsonb(t)->>$2)=$3`, [field, snake, value]);
    return rows.map((result: { row: Row }) => normalize(result.row));
  }

  async resolve(merchantId: string, storeId: string, featureId: string) {
    try {
      const [store] = await this.read('stores', 'id', storeId);
      if (!store || store.merchantId !== merchantId) throw new NotFoundException('Store not found');
      const [feature] = await this.read('features', 'id', featureId);
      const now = Date.now();
      const inPeriod = (row: Row) => (!row.effectiveFrom || Date.parse(row.effectiveFrom) <= now) &&
        (!row.effectiveUntil || Date.parse(row.effectiveUntil) > now);
      const [override] = (await this.read('store_entitlements', 'storeId', storeId))
        .filter(row => String(row.featureId).toLowerCase() === featureId.toLowerCase() && inPeriod(row));
      const planFeatureIds = new Set<string>();
      for (const license of await this.read('subscription_stores', 'storeId', storeId)) {
        if (license.merchantId !== merchantId || license.status !== 'ACTIVE') continue;
        const [subscription] = await this.read('subscriptions', 'id', license.subscriptionId);
        if (!subscription || !['ACTIVE', 'TRIAL', 'TRIALING', 'PENDING'].includes(subscription.status)) continue;
        if (subscription.planId) {
          for (const entry of await this.read('plan_entitlements', 'planId', subscription.planId)) {
            if (entry.enabled !== false) planFeatureIds.add(String(entry.featureId));
          }
        }
        for (const entry of (await this.read('subscription_entitlements', 'subscriptionId', subscription.id)).filter(inPeriod)) {
          if (entry.enabled !== false) planFeatureIds.add(String(entry.featureId));
        }
      }
      const result = canAccessFeature({
        featureId,
        feature,
        storeTypeCode: store.storeType || store.storeTypeId,
        override,
        planFeatureIds: [...planFeatureIds],
      });
      return { success: true, merchantId, storeId, featureId, allowed: result.allowed, reason: result.reason };
    } catch (error: any) {
      if (['42P01', '42703'].includes(error.driverError?.code || error.code)) {
        throw new ServiceUnavailableException('Feature access requires the subscription entitlement schemas');
      }
      throw error;
    }
  }

  async planFeatureIds(planId: string) {
    const rows = await this.read('plan_entitlements', 'planId', planId);
    return rows.filter(row => row.enabled !== false).map(row => String(row.featureId));
  }
}
