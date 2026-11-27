import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';

const PERIOD_DAYS: Record<string, number> = { today: 1, '7days': 7, '30days': 30 };

@Injectable()
export class MerchantDashboardService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async stores(merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(`
      SELECT id, store_name AS store_name, store_code AS store_code
        FROM public.stores
       WHERE merchant_id = $1::uuid AND COALESCE(is_deleted, false) = false
         AND upper(status::text) = 'ACTIVE'
       ORDER BY store_name, id`, [merchantId]);
    return { success: true, merchant_id: merchantId, stores: rows };
  }

  async overview(merchantId: string, requestedStoreId?: string, requestedPeriod = 'today') {
    const period = requestedPeriod.toLowerCase();
    const days = PERIOD_DAYS[period];
    if (!days) throw new BadRequestException('period must be today, 7days, or 30days');
    const storeId = requestedStoreId?.trim() || null;
    const db = this.merchants.requireDataSource();
    if (storeId) {
      const [owned] = await db.query(`SELECT id FROM public.stores WHERE id::text = $1 AND merchant_id = $2::uuid AND COALESCE(is_deleted, false) = false`, [storeId, merchantId]);
      if (!owned) throw new ForbiddenException('Store does not belong to this merchant');
    }
    const params = [merchantId, storeId, days];
    const [plan] = await db.query(`
      SELECT sub.status AS status,
             p.name AS plan_name,
             COALESCE(
               NULLIF(to_jsonb(p)->>'included_stores',''),
               NULLIF(to_jsonb(p)->>'stores_limit',''),
               NULLIF(to_jsonb(p)->>'includedStores',''),
               '0'
             )::int AS total_stores_allowed,
             COALESCE(
               to_jsonb(sub)->>'renewal_date',
               to_jsonb(sub)->>'renewalDate',
               to_jsonb(sub)->>'current_period_end',
               to_jsonb(sub)->>'currentPeriodEnd'
             ) AS renewal_date
        FROM public.subscriptions sub
        LEFT JOIN public.plans p
          ON p.id::text = COALESCE(to_jsonb(sub)->>'plan_id', to_jsonb(sub)->>'planId')
       WHERE COALESCE(to_jsonb(sub)->>'merchant_id', to_jsonb(sub)->>'merchantId') = $1
         AND upper(COALESCE(to_jsonb(sub)->>'status','')) IN ('ACTIVE','TRIAL','TRIALING')
         AND NOT (
           COALESCE(to_jsonb(sub)->>'renewal_date', to_jsonb(sub)->>'renewalDate',
                    to_jsonb(sub)->>'current_period_end', to_jsonb(sub)->>'currentPeriodEnd') IS NOT NULL
           AND COALESCE(to_jsonb(sub)->>'renewal_date', to_jsonb(sub)->>'renewalDate',
                        to_jsonb(sub)->>'current_period_end', to_jsonb(sub)->>'currentPeriodEnd')::timestamptz <= now()
         )
       ORDER BY COALESCE(to_jsonb(sub)->>'created_at', to_jsonb(sub)->>'createdAt')::timestamptz DESC NULLS LAST
       LIMIT 1`, [merchantId]);
    const [storeUsage] = await db.query(`
      SELECT COUNT(*)::int AS enrolled_stores
        FROM public.stores
       WHERE merchant_id=$1::uuid AND COALESCE(is_deleted,false)=false`, [merchantId]);
    const [summary] = await db.query(`
      WITH scoped_orders AS (
        SELECT o.* FROM public.store_orders o
        JOIN public.stores s ON s.id = o.store_id AND s.merchant_id = $1::uuid
         WHERE ($2::text IS NULL OR o.store_id::text = $2)
           AND o.created_at >= date_trunc('day', now()) - (($3::int - 1) * interval '1 day')
      )
      SELECT (SELECT COUNT(*)::int FROM public.stores s WHERE s.merchant_id = $1::uuid AND COALESCE(s.is_deleted,false)=false AND upper(s.status::text)='ACTIVE' AND ($2::text IS NULL OR s.id::text=$2)) AS stores,
             (SELECT COUNT(DISTINCT es.employee_id)::int FROM public.employee_stores es JOIN public.stores s ON s.id::text=es.store_id::text WHERE s.merchant_id=$1::uuid AND ($2::text IS NULL OR s.id::text=$2) AND COALESCE(to_jsonb(es)->>'status','ACTIVE')='ACTIVE') AS employees,
             COUNT(*)::int AS orders,
             COALESCE(SUM(o.total) FILTER (WHERE lower(o.status) IN ('completed','processing')),0)::numeric(14,2)::text AS sales
        FROM scoped_orders o`, params);
    const recentOrders = await db.query(`
      SELECT o.order_number AS order_number, o.store_id AS store_id, s.store_name AS store_name,
             o.customer_name AS customer_name, o.total::numeric(14,2)::text AS total,
             o.status, o.created_at AS created_at
        FROM public.store_orders o JOIN public.stores s ON s.id=o.store_id AND s.merchant_id=$1::uuid
       WHERE ($2::text IS NULL OR o.store_id::text=$2)
         AND o.created_at >= date_trunc('day', now()) - (($3::int - 1) * interval '1 day')
       ORDER BY o.created_at DESC LIMIT 10`, params);
    const roles = await db.query(`
      SELECT rt.id AS role_template_id,
             COALESCE(mrt.name, rt.name, 'Role') AS name,
             COUNT(DISTINCT srt.store_id)::int AS stores_enabled
        FROM public.store_role_templates srt
        JOIN public.stores s ON s.id=srt.store_id AND s.merchant_id=$1::uuid
        JOIN public.role_templates rt ON rt.id=srt.role_template_id
        LEFT JOIN public.merchant_role_templates mrt
          ON mrt.merchant_id=$1::uuid AND mrt.source_role_template_id=rt.id
         AND upper(mrt.status)='ACTIVE'
       WHERE srt.enabled=true AND upper(srt.status)='ACTIVE'
         AND upper(rt.status::text)='ACTIVE'
         AND COALESCE(s.is_deleted,false)=false
         AND ($2::text IS NULL OR s.id::text=$2)
       GROUP BY rt.id, COALESCE(mrt.name, rt.name, 'Role')
       ORDER BY name, rt.id`, [merchantId, storeId]);
    const topProducts = await db.query(`
      SELECT item->>'product_id' AS product_id, COALESCE(item->>'name', item->>'product_name', 'Unknown product') AS name,
             SUM(COALESCE(NULLIF(item->>'quantity','')::numeric,0))::numeric(14,2)::text AS units,
             SUM(COALESCE(NULLIF(item->>'total','')::numeric, NULLIF(item->>'subtotal','')::numeric,0))::numeric(14,2)::text AS revenue
        FROM public.store_orders o JOIN public.stores s ON s.id=o.store_id AND s.merchant_id=$1::uuid
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.line_items,'[]'::jsonb)) item
       WHERE ($2::text IS NULL OR o.store_id::text=$2)
         AND o.created_at >= date_trunc('day', now()) - (($3::int - 1) * interval '1 day')
         AND lower(o.status) IN ('completed','processing')
       GROUP BY 1,2 ORDER BY SUM(COALESCE(NULLIF(item->>'quantity','')::numeric,0)) DESC LIMIT 5`, params);
    const topCategories = await db.query(`
      SELECT COALESCE(category->>'name', category->>'slug', 'Uncategorized') AS name,
             SUM(COALESCE(NULLIF(item->>'quantity','')::numeric,0))::numeric(14,2)::text AS units
        FROM public.store_orders o JOIN public.stores s ON s.id=o.store_id AND s.merchant_id=$1::uuid
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.line_items,'[]'::jsonb)) item
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(item->'categories')='array' THEN item->'categories' ELSE '[{"name":"Uncategorized"}]'::jsonb END) category
       WHERE ($2::text IS NULL OR o.store_id::text=$2)
         AND o.created_at >= date_trunc('day', now()) - (($3::int - 1) * interval '1 day')
         AND lower(o.status) IN ('completed','processing')
       GROUP BY 1 ORDER BY units DESC LIMIT 5`, params);
    const shift = storeId ? null : (await db.query(`
      SELECT sh.id AS shift_id, sh.store_id AS store_id, s.store_name AS store_name, sh.opened_at AS started_at,
             sh.created_by AS opened_by,
             COALESCE(NULLIF(opening.meta_value #>> '{}','')::numeric, 0)::numeric(14,2)::text AS opening_cash,
             COALESCE(shift_sales.orders, 0)::int AS orders,
             COALESCE(shift_sales.sales, 0)::numeric(14,2)::text AS sales
        FROM public.pos_shifts sh JOIN public.stores s ON s.id::text=sh.store_id AND s.merchant_id=$1::uuid
        LEFT JOIN LATERAL (
          SELECT meta_value FROM public.pos_shift_meta
           WHERE shift_id=sh.id AND meta_name IN ('opening_cash','opening_balance') AND status='ACTIVE'
           ORDER BY id LIMIT 1
        ) opening ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total),0) AS sales
            FROM public.store_orders o
           WHERE o.store_id::text=sh.store_id AND (o.shift_id=sh.id OR o.local_shift_id=sh.id)
             AND lower(o.status)='completed'
        ) shift_sales ON true
       WHERE upper(COALESCE(to_jsonb(sh)->>'status','OPEN')) IN ('OPEN','IN_PROGRESS')
       ORDER BY sh.opened_at DESC LIMIT 1`, [merchantId]))[0] || null;
    return {
      success: true, merchant_id: merchantId, store_id: storeId, period,
      metrics: { stores: Number(summary.stores), employees: Number(summary.employees), sales: Number(summary.sales), orders: Number(summary.orders) },
      subscription_plan: plan ? {
        status: plan.status,
        plan_name: plan.plan_name,
        total_stores_allowed: Number(plan.total_stores_allowed),
        store_limit: Number(plan.total_stores_allowed),
        enrolled_stores: Number(storeUsage.enrolled_stores),
        renewal_date: plan.renewal_date,
      } : null,
      roles_count: roles.length,
      roles: roles.map((role: { role_template_id: string; name: string; stores_enabled: number }) => ({
        role_template_id: role.role_template_id,
        name: role.name,
        stores_enabled: Number(role.stores_enabled),
      })),
      recent_orders: recentOrders,
      current_shift: shift,
      top_products: topProducts,
      top_categories: topCategories,
    };
  }
}
