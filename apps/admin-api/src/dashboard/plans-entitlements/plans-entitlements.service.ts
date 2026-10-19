import { Inject, Injectable } from '@nestjs/common';
import { DashboardDatabase } from '../dashboard.database';
import { PlansEntitlementsResponseDto } from './dto/plans-entitlements-response.dto';

type PlanRow = {
  planId: string;
  planCode: string;
  planName: string;
  includedStores: string | number;
  includedTerminals: string | number;
  activeSubscriptions: string | number;
};

type TotalsRow = {
  activeSubscriptions: string | number;
  merchantsAtStoreCapacity: string | number;
  merchantsAtTerminalCapacity: string | number;
  expiredSubscriptions: string | number;
};

@Injectable()
export class PlansEntitlementsService {
  constructor(@Inject(DashboardDatabase) private readonly database: DashboardDatabase) {}

  async getSummary(): Promise<PlansEntitlementsResponseDto> {
    const dataSource = await this.database.getConnection();
    const plans = await dataSource.query<PlanRow[]>(`
      SELECT p.id::text AS "planId",
             COALESCE(to_jsonb(p)->>'plan_code', to_jsonb(p)->>'planCode', '') AS "planCode",
             COALESCE(to_jsonb(p)->>'name', '') AS "planName",
             COALESCE(NULLIF(to_jsonb(p)->>'stores_limit', '')::integer,
                      NULLIF(to_jsonb(p)->>'storesLimit', '')::integer, 0) AS "includedStores",
             COALESCE(NULLIF(to_jsonb(p)->>'terminal_limit', '')::integer,
                      NULLIF(to_jsonb(p)->>'terminalLimit', '')::integer, 0) AS "includedTerminals",
             COUNT(s.id) FILTER (WHERE COALESCE(to_jsonb(s)->>'status', '') = 'ACTIVE')::integer AS "activeSubscriptions"
        FROM public.plans p
        LEFT JOIN public.subscriptions s
          ON COALESCE(to_jsonb(s)->>'plan_id', to_jsonb(s)->>'planId') = p.id::text
       GROUP BY p.id, p.plan_code, p.name
       ORDER BY p.name`);

    const [totals] = await dataSource.query<TotalsRow[]>(`
      WITH active_subscriptions AS (
        SELECT DISTINCT ON (s.merchant_id) s.merchant_id, s.plan_id
          FROM public.subscriptions s
         WHERE COALESCE(to_jsonb(s)->>'status', '') = 'ACTIVE'
         ORDER BY s.merchant_id, s.created_at DESC NULLS LAST
      ), capacity AS (
        SELECT a.merchant_id,
               COALESCE(NULLIF(to_jsonb(p)->>'stores_limit', '')::integer,
                        NULLIF(to_jsonb(p)->>'storesLimit', '')::integer, 0) AS stores_limit,
               COALESCE(NULLIF(to_jsonb(p)->>'terminal_limit', '')::integer,
                        NULLIF(to_jsonb(p)->>'terminalLimit', '')::integer, 0) AS terminal_limit,
               (SELECT COUNT(*) FROM public.stores st WHERE st.merchant_id = a.merchant_id) AS store_count,
               (SELECT COUNT(*) FROM public.devices d WHERE d.merchant_id = a.merchant_id) AS terminal_count
          FROM active_subscriptions a
          JOIN public.plans p ON p.id::text = a.plan_id::text
      ), expired AS (
        SELECT COUNT(*)::integer AS count
          FROM public.subscriptions s
         WHERE COALESCE(to_jsonb(s)->>'status', '') = 'EXPIRED'
            OR (COALESCE(to_jsonb(s)->>'status', '') = 'ACTIVE'
                AND NULLIF(to_jsonb(s)->>'renewal_date', '')::date < CURRENT_DATE)
      )
      SELECT (SELECT COUNT(*)::integer FROM public.subscriptions s
               WHERE COALESCE(to_jsonb(s)->>'status', '') = 'ACTIVE') AS "activeSubscriptions",
             (SELECT COUNT(*)::integer FROM capacity WHERE stores_limit > 0 AND store_count >= stores_limit) AS "merchantsAtStoreCapacity",
             (SELECT COUNT(*)::integer FROM capacity WHERE terminal_limit > 0 AND terminal_count >= terminal_limit) AS "merchantsAtTerminalCapacity",
             (SELECT count FROM expired) AS "expiredSubscriptions"`);

    return {
      plans: plans.map(plan => ({
        ...plan,
        includedStores: Number(plan.includedStores),
        includedTerminals: Number(plan.includedTerminals),
        activeSubscriptions: Number(plan.activeSubscriptions),
      })),
      totals: {
        activeSubscriptions: Number(totals.activeSubscriptions),
        merchantsAtStoreCapacity: Number(totals.merchantsAtStoreCapacity),
        merchantsAtTerminalCapacity: Number(totals.merchantsAtTerminalCapacity),
        expiredSubscriptions: Number(totals.expiredSubscriptions),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
