import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError, type EntityManager } from 'typeorm';
import { OrderRepository } from '../order.repository';
import { ensureLoyaltySchema } from './loyalty.schema';

export interface LoyaltyScope {
  merchantId: string;
  storeId: string;
  actorId?: string;
}

export interface CustomerRow {
  id: string;
  merchant_id: string;
  store_id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  username: string;
  customer_role: string;
  created_at: Date;
}

export interface OrderRow {
  id: string;
  order_id: string;
  merchant_id: string;
  store_id: string;
  client_order_id: string | null;
  order_number: string;
  customer_phone?: string | null;
  payment_status?: string | null;
  status: string;
  order_status: string;
  total: string | number;
  grand_total?: string | number;
  discount_total: string | number;
  tax_total: string | number;
  subtotal: string | number;
  fee_total: string | number;
  tip_amount: string | number;
  line_items: unknown;
  fee_lines: unknown;
  coupon_lines: unknown;
  tax_lines: unknown;
  request_payload: unknown;
  meta_data: unknown;
  metadata: unknown;
}

type Queryable = { query: (sql: string, parameters?: unknown[]) => Promise<unknown> };

@Injectable()
export class LoyaltyRepository {
  private schemaReady = false;

  constructor(@Inject(OrderRepository) private readonly orders: OrderRepository) {}

  async ensure(): Promise<Queryable> {
    const db = this.orders.database();
    if (!db) throw new ServiceUnavailableException('Order database is unavailable');
    if (!this.schemaReady) {
      await db.transaction(async (manager) => {
        await ensureLoyaltySchema(manager);
      });
      this.schemaReady = true;
    }
    return db;
  }

  async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const db = await this.ensure();
    return (db as unknown as { transaction: <R>(fn: (manager: EntityManager) => Promise<R>) => Promise<R> }).transaction(work);
  }

  async pluginActive(scope: LoyaltyScope, db: Queryable = this.orders.database() as Queryable): Promise<boolean> {
    const entitled = await this.featureActive(db,
      `SELECT 1
         FROM public.store_entitlements AS entitlement
         JOIN public.features AS feature ON feature.id = entitlement.feature_id
        WHERE entitlement.store_id = $1::uuid
          AND entitlement.enabled IS TRUE
          AND (entitlement.effective_from IS NULL OR entitlement.effective_from <= now())
          AND (entitlement.effective_until IS NULL OR entitlement.effective_until > now())
          AND (
            lower(COALESCE(to_jsonb(feature)->>'name', '')) LIKE '%loyal%'
            OR lower(COALESCE(
                 to_jsonb(feature)->>'feature_key',
                 to_jsonb(feature)->>'feature_code',
                 to_jsonb(feature)->>'featureKey',
                 ''
               )) = 'loyalty'
          )
        LIMIT 1`,
      [scope.storeId],
    );
    if (entitled) return true;
    return this.featureActive(db,
      `SELECT 1
         FROM public.store_features AS store_feature
         LEFT JOIN public.features AS feature ON feature.id = store_feature.feature_id
        WHERE store_feature.store_id = $1::uuid
          AND store_feature.enabled IS TRUE
          AND (
            lower(store_feature.feature_name) LIKE '%loyal%'
            OR lower(COALESCE(feature.name, '')) LIKE '%loyal%'
            OR lower(COALESCE(feature.feature_code, '')) = 'loyalty'
          )
        LIMIT 1`,
      [scope.storeId],
    );
  }

  async readConfig(scope: LoyaltyScope, name: string, db?: Queryable): Promise<Record<string, unknown>> {
    const rows = await this.query(db || await this.ensure(),
      `SELECT configuration_value
         FROM public.store_pos_configurations
        WHERE store_id = $1::uuid AND configuration_name = $2
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [scope.storeId, name],
    );
    return (rows[0]?.configuration_value as Record<string, unknown>) || {};
  }

  async saveLoyaltyConfig(scope: LoyaltyScope, value: Record<string, unknown>, manager?: Queryable): Promise<void> {
    const db = manager || await this.ensure();
    const actor = uuidOrNull(scope.actorId);
    const updated = await db.query(
      `UPDATE public.store_pos_configurations
          SET configuration_value = $2::jsonb,
              updated_by = $3::uuid,
              updated_at = now()
        WHERE store_id = $1::uuid
          AND configuration_name = 'store_loyalty'
        RETURNING id`,
      [scope.storeId, JSON.stringify(value), actor],
    );
    if (updated.length) return;
    await db.query(
      `INSERT INTO public.store_pos_configurations
         (store_id, configuration_name, configuration_value, created_by, updated_by)
       SELECT $1::uuid, 'store_loyalty', $2::jsonb, $3::uuid, $3::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM public.store_pos_configurations
           WHERE store_id = $1::uuid AND configuration_name = 'store_loyalty'
        )`,
      [scope.storeId, JSON.stringify(value), actor],
    );
  }

  async findCustomer(scope: LoyaltyScope, contact: string, email: boolean, manager?: Queryable): Promise<CustomerRow | undefined> {
    const db = manager || await this.ensure();
    const rows = email
      ? await this.query(db,
        `SELECT customer.*
           FROM public.store_customers AS customer
          WHERE customer.merchant_id = $1::uuid
            AND customer.store_id = $2::uuid
            AND customer.customer_role = 'customer'
            AND lower(customer.email) = lower($3)
          ORDER BY customer.created_at ASC
          LIMIT 1`,
        [scope.merchantId, scope.storeId, contact],
      )
      : await this.query(db,
        `SELECT customer.*
           FROM public.store_customers AS customer
           LEFT JOIN public.store_customer_meta_data AS phone
             ON phone.customer_id = customer.id AND phone.meta_key = 'billing_phone'
          WHERE customer.merchant_id = $1::uuid
            AND customer.store_id = $2::uuid
            AND customer.customer_role = 'customer'
            AND (
              customer.mobile = $3
              OR phone.meta_value #>> '{}' = $3
              OR (
                regexp_replace($3, '\\D', '', 'g') <> ''
                AND (
                  regexp_replace(COALESCE(customer.mobile, ''), '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')
                  OR regexp_replace(COALESCE(phone.meta_value #>> '{}', ''), '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')
                  OR (
                    length(regexp_replace($3, '\\D', '', 'g')) >= 10
                    AND right(regexp_replace(COALESCE(customer.mobile, ''), '\\D', '', 'g'), 10) = right(regexp_replace($3, '\\D', '', 'g'), 10)
                  )
                  OR (
                    length(regexp_replace($3, '\\D', '', 'g')) >= 10
                    AND right(regexp_replace(COALESCE(phone.meta_value #>> '{}', ''), '\\D', '', 'g'), 10) = right(regexp_replace($3, '\\D', '', 'g'), 10)
                  )
                )
              )
            )
          ORDER BY customer.created_at ASC
          LIMIT 1`,
        [scope.merchantId, scope.storeId, contact],
      );
    return rows[0] as CustomerRow | undefined;
  }

  async findCustomerById(scope: LoyaltyScope, customerId: string, manager?: Queryable): Promise<CustomerRow | undefined> {
    const rows = await this.query(manager || await this.ensure(),
      `SELECT *
         FROM public.store_customers
        WHERE id = $1::uuid AND merchant_id = $2::uuid AND store_id = $3::uuid AND customer_role = 'customer'`,
      [customerId, scope.merchantId, scope.storeId],
    );
    return rows[0] as CustomerRow | undefined;
  }

  async insertCustomer(scope: LoyaltyScope, input: {
    name: string;
    email: string | null;
    mobile: string | null;
    username: string;
  }, manager: Queryable): Promise<CustomerRow> {
    let username = input.username;
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? username : `${input.username}_${suffix}`;
      const existing = await this.query(manager,
        `SELECT 1 FROM public.store_customers
          WHERE merchant_id = $1::uuid AND store_id = $2::uuid AND username = $3 LIMIT 1`,
        [scope.merchantId, scope.storeId, candidate],
      );
      if (!existing.length) {
        username = candidate;
        break;
      }
    }
    const rows = await this.query(manager,
      `INSERT INTO public.store_customers
         (merchant_id, store_id, name, email, mobile, username, customer_role)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'customer')
       RETURNING *`,
      [scope.merchantId, scope.storeId, input.name, input.email, input.mobile, username],
    );
    return rows[0] as CustomerRow;
  }

  async readMeta(customerId: string, manager?: Queryable): Promise<Record<string, unknown>> {
    const rows = await this.query(manager || await this.ensure(),
      `SELECT meta_key, meta_value FROM public.store_customer_meta_data WHERE customer_id = $1::uuid`,
      [customerId],
    );
    return Object.fromEntries(rows.map((row) => [row.meta_key, unwrapJson(row.meta_value)]));
  }

  async writeMeta(customerId: string, entries: Record<string, unknown>, manager: Queryable): Promise<void> {
    const pairs = Object.entries(entries);
    if (!pairs.length) return;
    for (const [key, value] of pairs) {
      const updated = await manager.query(
        `UPDATE public.store_customer_meta_data
            SET meta_value = $3::jsonb,
                updated_at = now()
          WHERE customer_id = $1::uuid AND meta_key = $2
          RETURNING id`,
        [customerId, key, JSON.stringify(value)],
      );
      if (updated.length) continue;
      await manager.query(
        `INSERT INTO public.store_customer_meta_data (customer_id, meta_key, meta_value)
         SELECT $1::uuid, $2, $3::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM public.store_customer_meta_data
             WHERE customer_id = $1::uuid AND meta_key = $2
          )`,
        [customerId, key, JSON.stringify(value)],
      );
    }
  }

  async lockOrder(scope: LoyaltyScope, orderKey: string, manager: Queryable): Promise<OrderRow | undefined> {
    const rows = await this.query(manager,
      `SELECT *
         FROM public.store_orders
        WHERE merchant_id = $1::uuid
          AND store_id = $2::uuid
          AND (
            client_order_id = $3
            OR order_id::text = $3
            OR id::text = $3
            OR order_number = $3
            OR order_number = '#' || $3
          )
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [scope.merchantId, scope.storeId, orderKey],
    );
    const order = rows[0] as OrderRow | undefined;
    if (!order) return undefined;
    const meta = await this.orderMeta(order.order_id, manager);
    order.meta_data = mergeMeta(order.meta_data, meta);
    order.metadata = order.meta_data;
    return order;
  }

  async orderMeta(orderId: string, manager?: Queryable): Promise<Array<{ key: string; value: unknown }>> {
    try {
      const rows = await this.query(manager || await this.ensure(),
        `SELECT meta_key, meta_value FROM public.store_orders_meta WHERE order_id = $1::uuid`,
        [orderId],
      );
      return rows.map((row) => ({ key: String(row.meta_key), value: unwrapJson(row.meta_value) }));
    } catch (error) {
      if (missingRelation(error)) return [];
      throw error;
    }
  }

  async saveOrderMeta(orderId: string, entries: Array<{ key: string; value: unknown }>, manager: Queryable): Promise<void> {
    if (!entries.length) return;
    await manager.query(
      `INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
       VALUES ${entries.map((_, index) => `($1::uuid, $${index * 2 + 2}, $${index * 2 + 3}::jsonb)`).join(', ')}
       ON CONFLICT (order_id, meta_key)
       DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = now()`,
      [orderId, ...entries.flatMap((entry) => [entry.key, JSON.stringify(entry.value)])],
    );
  }

  async deleteOrderMeta(orderId: string, keys: string[], manager: Queryable): Promise<void> {
    if (!keys.length) return;
    await manager.query(
      `DELETE FROM public.store_orders_meta WHERE order_id = $1::uuid AND meta_key = ANY($2::text[])`,
      [orderId, keys],
    );
  }

  async saveOrder(order: OrderRow, manager: Queryable): Promise<void> {
    await manager.query(
      `UPDATE public.store_orders
          SET status = $2,
              line_items = $3::jsonb,
              meta_data = $4::jsonb,
              metadata = $4::jsonb,
              subtotal = $5,
              discount_total = $6,
              fee_total = $7,
              tax_total = $8,
              total = $9,
              grand_total = $10,
              updated_at = now()
        WHERE order_id = $1::uuid`,
      [order.order_id, order.status, JSON.stringify(order.line_items || []), JSON.stringify(order.meta_data || []),
        order.subtotal, order.discount_total, order.fee_total, order.tax_total, order.total, order.total],
    );
  }

  async canonicalLines(orderId: string, manager?: Queryable): Promise<Array<{ id: string; modifiers: unknown }>> {
    try {
      const rows = await this.query(manager || await this.ensure(),
        `SELECT id, modifiers FROM public.order_line_items WHERE order_id = $1::uuid`,
        [orderId],
      );
      return rows.map((row) => ({ id: String(row.id), modifiers: row.modifiers }));
    } catch (error) {
      if (missingRelation(error)) return [];
      throw error;
    }
  }

  async updateLineModifiers(orderId: string, lineId: string, modifiers: unknown, manager: Queryable): Promise<void> {
    await manager.query(
      `UPDATE public.order_line_items
          SET modifiers = $3::jsonb
        WHERE order_id = $1::uuid AND id = $2`,
      [orderId, lineId, JSON.stringify(modifiers || [])],
    );
  }

  async replaceCanonicalLines(orderId: string, lines: Array<Record<string, unknown>>, manager: Queryable): Promise<void> {
    await manager.query(`DELETE FROM public.order_line_items WHERE order_id = $1::uuid`, [orderId]);
    if (!lines.length) return;
    const used = new Set<string>();
    for (const [index, line] of lines.entries()) {
      const quantity = finiteNumber(line.quantity, 1);
      const total = finiteNumber(line.total ?? line.subtotal, 0);
      let id = String(line.id || `ITEM-${orderId}-${index + 1}`).slice(0, 100);
      if (used.has(id)) id = `ITEM-${orderId}-${index + 1}`.slice(0, 100);
      used.add(id);
      await manager.query(
        `INSERT INTO public.order_line_items
           (id, order_id, product_id, product_name, quantity, unit_price, total_price, modifiers)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          id,
          orderId,
          String(line.product_id ?? line.productId ?? '').slice(0, 100),
          String(line.name || 'Sales Item').slice(0, 255),
          quantity,
          quantity ? total / quantity : 0,
          total,
          JSON.stringify(line.meta_data || line.modifiers || []),
        ],
      );
    }
  }

  async catalog(scope: LoyaltyScope, manager?: Queryable): Promise<unknown> {
    try {
      const rows = await this.query(manager || await this.ensure(),
        `SELECT payload FROM public.store_products
          WHERE store_id = $1::uuid AND COALESCE(is_deleted, false) = false
          LIMIT 1`,
        [scope.storeId],
      );
      return rows[0]?.payload || [];
    } catch (error) {
      if (missingRelation(error)) return [];
      throw error;
    }
  }

  async paymentCount(orderId: string, manager?: Queryable): Promise<number> {
    try {
      const rows = await this.query(manager || await this.ensure(),
        `SELECT COUNT(*)::int AS count
           FROM public.store_pos_payments
          WHERE order_id = $1::uuid AND deleted_at IS NULL AND entry_type = 'payment'`,
        [orderId],
      );
      return Number(rows[0]?.count || 0);
    } catch (error) {
      if (missingRelation(error)) return 0;
      throw error;
    }
  }

  async payments(scope: LoyaltyScope, orderId: string, manager?: Queryable): Promise<Array<Record<string, unknown>>> {
    try {
      return await this.query(manager || await this.ensure(),
        `SELECT amount, is_void, entry_type, metadata
           FROM public.store_pos_payments
          WHERE order_id = $1::uuid AND merchant_id = $2::uuid AND store_id = $3::uuid
            AND deleted_at IS NULL`,
        [orderId, scope.merchantId, scope.storeId],
      );
    } catch (error) {
      if (missingRelation(error)) return [];
      throw error;
    }
  }

  async ledgerTotals(scope: LoyaltyScope, customerId: string, manager?: Queryable): Promise<{ credited: number; redeemed: number; expired: number }> {
    const rows = await this.query(manager || await this.ensure(),
      `SELECT COALESCE(SUM(credited_points), 0) AS credited,
              COALESCE(SUM(redeemed_points), 0) AS redeemed,
              COALESCE(SUM(expired_points), 0) AS expired
         FROM public.store_customer_loyalty_points
        WHERE customer_id = $1::uuid AND merchant_id = $2::uuid AND store_id = $3::uuid`,
      [customerId, scope.merchantId, scope.storeId],
    );
    return {
      credited: Number(rows[0]?.credited || 0),
      redeemed: Number(rows[0]?.redeemed || 0),
      expired: Number(rows[0]?.expired || 0),
    };
  }

  async expireDuePoints(scope: LoyaltyScope, customerId: string, manager: Queryable): Promise<void> {
    await manager.query(
      `UPDATE public.store_customer_loyalty_points
          SET expired_points = GREATEST(0, credited_points - redeemed_points),
              points_status = 'expired',
              updated_at = now()
        WHERE customer_id = $1::uuid
          AND merchant_id = $2::uuid
          AND store_id = $3::uuid
          AND points_status = 'active'
          AND points_expiry_date IS NOT NULL
          AND points_expiry_date <= now()
          AND credited_points > redeemed_points` ,
      [customerId, scope.merchantId, scope.storeId],
    );
  }

  async completedUncreditedOrderIds(
    scope: LoyaltyScope,
    customerId: string,
    contact: string,
    manager: Queryable,
  ): Promise<string[]> {
    const digits = contact.replace(/\D/g, '');
    const rows = await this.query(manager,
      `SELECT sale.order_id
         FROM public.store_orders AS sale
        WHERE sale.merchant_id = $1::uuid
          AND sale.store_id = $2::uuid
          AND (
            lower(replace(COALESCE(sale.status, ''), '_', '-')) IN ('completed', 'wc-completed')
            OR lower(replace(COALESCE(sale.order_status, ''), '_', '-')) IN ('completed', 'wc-completed')
            OR (
              upper(COALESCE(sale.payment_status, '')) = 'PAID'
              AND lower(replace(COALESCE(sale.status, ''), '_', '-')) NOT IN ('cancelled', 'canceled', 'refunded', 'failed')
              AND lower(replace(COALESCE(sale.order_status, ''), '_', '-')) NOT IN ('cancelled', 'canceled', 'refunded', 'failed')
            )
          )
          AND (
            EXISTS (
              SELECT 1
                FROM public.store_orders_meta AS meta
               WHERE meta.order_id = sale.order_id
                 AND (
                   (meta.meta_key = 'loyaltyuser_id' AND meta.meta_value #>> '{}' = $3)
                   OR (meta.meta_key = 'contact' AND lower(meta.meta_value #>> '{}') = lower($4))
                   OR (
                     $5 <> ''
                     AND meta.meta_key IN ('contact', 'billing_phone')
                     AND (
                       regexp_replace(COALESCE(meta.meta_value #>> '{}', ''), '\\D', '', 'g') = $5
                       OR (
                         length($5) >= 10
                         AND right(regexp_replace(COALESCE(meta.meta_value #>> '{}', ''), '\\D', '', 'g'), 10) = right($5, 10)
                       )
                     )
                   )
                 )
            )
            OR (
              $5 <> ''
              AND (
                regexp_replace(COALESCE(sale.customer_phone, ''), '\\D', '', 'g') = $5
                OR (
                  length($5) >= 10
                  AND right(regexp_replace(COALESCE(sale.customer_phone, ''), '\\D', '', 'g'), 10) = right($5, 10)
                )
              )
            )
            OR (
              position('@' in $4) > 0
              AND lower(COALESCE(sale.request_payload #>> '{billing,email}', '')) = lower($4)
            )
            OR (
              $5 <> ''
              AND (
                regexp_replace(COALESCE(sale.request_payload #>> '{billing,phone}', ''), '\\D', '', 'g') = $5
                OR (
                  length($5) >= 10
                  AND right(regexp_replace(COALESCE(sale.request_payload #>> '{billing,phone}', ''), '\\D', '', 'g'), 10) = right($5, 10)
                )
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM public.store_customer_loyalty_points AS ledger
             WHERE ledger.customer_id = $3::uuid
               AND ledger.order_id = sale.order_id
               AND ledger.credited_points > 0
               AND ledger.source_refund_id IS NULL
          )`,
      [scope.merchantId, scope.storeId, customerId, contact, digits],
    );
    return rows.map((row) => String(row.order_id));
  }

  async eligibleOrderIdsForContact(scope: LoyaltyScope, contact: string, manager: Queryable): Promise<string[]> {
    const digits = contact.replace(/\D/g, '');
    const rows = await this.query(manager,
      `SELECT sale.order_id
         FROM public.store_orders AS sale
        WHERE sale.merchant_id = $1::uuid
          AND sale.store_id = $2::uuid
          AND (
            lower(replace(COALESCE(sale.status, ''), '_', '-')) IN ('completed', 'wc-completed')
            OR lower(replace(COALESCE(sale.order_status, ''), '_', '-')) IN ('completed', 'wc-completed')
            OR (
              upper(COALESCE(sale.payment_status, '')) = 'PAID'
              AND lower(replace(COALESCE(sale.status, ''), '_', '-')) NOT IN ('cancelled', 'canceled', 'refunded', 'failed')
              AND lower(replace(COALESCE(sale.order_status, ''), '_', '-')) NOT IN ('cancelled', 'canceled', 'refunded', 'failed')
            )
          )
          AND (
            EXISTS (
              SELECT 1
                FROM public.store_orders_meta AS meta
               WHERE meta.order_id = sale.order_id
                 AND (
                   (meta.meta_key = 'contact' AND lower(meta.meta_value #>> '{}') = lower($3))
                   OR (
                     $4 <> ''
                     AND meta.meta_key IN ('contact', 'billing_phone')
                     AND (
                       regexp_replace(COALESCE(meta.meta_value #>> '{}', ''), '\\D', '', 'g') = $4
                       OR (
                         length($4) >= 10
                         AND right(regexp_replace(COALESCE(meta.meta_value #>> '{}', ''), '\\D', '', 'g'), 10) = right($4, 10)
                       )
                     )
                   )
                 )
            )
            OR (
              $4 <> ''
              AND (
                regexp_replace(COALESCE(sale.customer_phone, ''), '\\D', '', 'g') = $4
                OR (
                  length($4) >= 10
                  AND right(regexp_replace(COALESCE(sale.customer_phone, ''), '\\D', '', 'g'), 10) = right($4, 10)
                )
              )
            )
            OR (
              position('@' in $3) > 0
              AND lower(COALESCE(sale.request_payload #>> '{billing,email}', '')) = lower($3)
            )
            OR (
              $4 <> ''
              AND (
                regexp_replace(COALESCE(sale.request_payload #>> '{billing,phone}', ''), '\\D', '', 'g') = $4
                OR (
                  length($4) >= 10
                  AND right(regexp_replace(COALESCE(sale.request_payload #>> '{billing,phone}', ''), '\\D', '', 'g'), 10) = right($4, 10)
                )
              )
            )
          )`,
      [scope.merchantId, scope.storeId, contact, digits],
    );
    return rows.map((row) => String(row.order_id));
  }

  async hasOrderCredit(scope: LoyaltyScope, customerId: string, orderId: string, manager?: Queryable): Promise<boolean> {
    const rows = await this.query(manager || await this.ensure(),
      `SELECT 1
         FROM public.store_customer_loyalty_points
        WHERE customer_id = $1::uuid AND merchant_id = $2::uuid AND store_id = $3::uuid
          AND order_id = $4::uuid
          AND credited_points > 0
          AND source_refund_id IS NULL
        LIMIT 1`,
      [customerId, scope.merchantId, scope.storeId, orderId],
    );
    return rows.length > 0;
  }

  async insertCredit(scope: LoyaltyScope, input: {
    customerId: string;
    contact: string;
    orderId: string;
    clientOrderId: string | null;
    creditedPoints: number;
    expiresAt: Date;
  }, manager: Queryable): Promise<boolean> {
    const rows = await this.query(manager,
      `INSERT INTO public.store_customer_loyalty_points
         (customer_id, merchant_id, store_id, contact, order_id, client_order_id,
          credited_points, redeemed_points, expired_points,
          points_created_date, points_expiry_date, points_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, 0, 0, now(), $8, 'active')
       ON CONFLICT (customer_id, order_id) WHERE source_refund_id IS NULL AND credited_points > 0
       DO NOTHING
       RETURNING id`,
      [input.customerId, scope.merchantId, scope.storeId, input.contact, input.orderId,
        input.clientOrderId, input.creditedPoints, input.expiresAt],
    );
    return rows.length > 0;
  }

  async insertRedeem(scope: LoyaltyScope, input: {
    customerId: string;
    contact: string;
    orderId: string;
    clientOrderId: string | null;
    redeemedPoints: number;
  }, manager: Queryable): Promise<void> {
    await this.query(manager,
      `INSERT INTO public.store_customer_loyalty_points
         (customer_id, merchant_id, store_id, contact, order_id, client_order_id,
          credited_points, redeemed_points, expired_points,
          points_created_date, points_expiry_date, points_status)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, 0, $7, 0, now(), now(), 'redeemed'
        WHERE NOT EXISTS (
          SELECT 1
            FROM public.store_customer_loyalty_points
           WHERE customer_id = $1::uuid
             AND merchant_id = $2::uuid
             AND store_id = $3::uuid
             AND order_id = $5::uuid
             AND redeemed_points > 0
             AND source_refund_id IS NULL
        )`,
      [input.customerId, scope.merchantId, scope.storeId, input.contact, input.orderId,
        input.clientOrderId, input.redeemedPoints],
    );
  }

  async deleteOrderRedemption(scope: LoyaltyScope, customerId: string, orderId: string, manager: Queryable): Promise<void> {
    await this.query(manager,
      `DELETE FROM public.store_customer_loyalty_points
        WHERE customer_id = $1::uuid
          AND merchant_id = $2::uuid
          AND store_id = $3::uuid
          AND order_id = $4::uuid
          AND redeemed_points > 0
          AND credited_points = 0
          AND source_refund_id IS NULL`,
      [customerId, scope.merchantId, scope.storeId, orderId],
    );
  }

  async updateLineItems(orderId: string, lines: unknown, manager: Queryable): Promise<void> {
    await manager.query(
      `UPDATE public.store_orders SET line_items = $2::jsonb, updated_at = now() WHERE order_id = $1::uuid`,
      [orderId, JSON.stringify(lines || [])],
    );
  }

  async insertExpired(scope: LoyaltyScope, input: {
    customerId: string;
    contact: string;
    orderId: string;
    clientOrderId: string | null;
    expiredPoints: number;
    refundId: string;
  }, manager: Queryable): Promise<boolean> {
    const rows = await this.query(manager,
      `INSERT INTO public.store_customer_loyalty_points
         (customer_id, merchant_id, store_id, contact, order_id, client_order_id,
          credited_points, redeemed_points, expired_points,
          points_created_date, points_expiry_date, points_status, source_refund_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, 0, 0, $7, now(), now(), 'expired', $8::uuid)
       ON CONFLICT (customer_id, order_id, source_refund_id) WHERE source_refund_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [input.customerId, scope.merchantId, scope.storeId, input.contact, input.orderId,
        input.clientOrderId, input.expiredPoints, input.refundId],
    );
    return rows.length > 0;
  }

  async deleteOrderLedger(scope: LoyaltyScope, orderId: string, clientOrderId: string | null, manager: Queryable): Promise<string[]> {
    const rows = await this.query(manager,
      `DELETE FROM public.store_customer_loyalty_points
        WHERE merchant_id = $1::uuid AND store_id = $2::uuid
          AND (order_id = $3::uuid OR ($4::text IS NOT NULL AND client_order_id = $4))
        RETURNING customer_id`,
      [scope.merchantId, scope.storeId, orderId, clientOrderId],
    );
    return [...new Set(rows.map((row) => String(row.customer_id)))];
  }

  async customersWithContact(scope: LoyaltyScope): Promise<Array<CustomerRow & { contact: string }>> {
    const rows = await this.query(await this.ensure(),
      `SELECT customer.*, contact.meta_value #>> '{}' AS contact
         FROM public.store_customers AS customer
         JOIN public.store_customer_meta_data AS contact
           ON contact.customer_id = customer.id AND contact.meta_key = 'contact'
        WHERE customer.merchant_id = $1::uuid
          AND customer.store_id = $2::uuid
          AND customer.customer_role = 'customer'
          AND COALESCE(contact.meta_value #>> '{}', '') <> ''
        ORDER BY customer.created_at DESC`,
      [scope.merchantId, scope.storeId],
    );
    return rows as Array<CustomerRow & { contact: string }>;
  }

  async ledgerForCustomer(scope: LoyaltyScope, customerId: string): Promise<Array<Record<string, unknown>>> {
    return this.query(await this.ensure(),
      `SELECT ledger.order_id::text AS order_id, ledger.client_order_id, sale.order_number,
              sale.total AS order_amount,
              ledger.credited_points, ledger.redeemed_points, ledger.expired_points, ledger.points_status,
              ledger.points_created_date, ledger.points_expiry_date,
              COALESCE(meta.meta_value #>> '{}', '0') AS order_redeem_points
         FROM public.store_customer_loyalty_points AS ledger
         LEFT JOIN LATERAL (
           SELECT candidate.order_number, candidate.total
             FROM public.store_orders AS candidate
            WHERE candidate.order_id = ledger.order_id
               OR (ledger.client_order_id IS NOT NULL
                   AND candidate.client_order_id = ledger.client_order_id)
               OR (ledger.client_order_id IS NOT NULL
                   AND candidate.order_number = ledger.client_order_id)
            ORDER BY (candidate.order_id = ledger.order_id) DESC
            LIMIT 1
         ) AS sale ON true
         LEFT JOIN public.store_orders_meta AS meta
           ON meta.order_id = ledger.order_id AND meta.meta_key = 'redeem_points'
        WHERE ledger.customer_id = $1::uuid
          AND ledger.merchant_id = $2::uuid
          AND ledger.store_id = $3::uuid
        ORDER BY ledger.points_created_date DESC NULLS LAST, ledger.created_at DESC`,
      [customerId, scope.merchantId, scope.storeId],
    );
  }

  private async featureActive(db: Queryable, sql: string, parameters: unknown[]): Promise<boolean> {
    try {
      const rows = await this.query(db, sql, parameters);
      return rows.length > 0;
    } catch (error) {
      if (!missingRelation(error)) throw error;
      return false;
    }
  }

  private async query(db: Queryable, sql: string, parameters: unknown[] = []): Promise<Array<Record<string, any>>> {
    try {
      const result = await db.query(sql, parameters);
      return normalize(result);
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[0];
    return result as Array<Record<string, any>>;
  }
  return [];
}

function unwrapJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function mergeMeta(current: unknown, stored: Array<{ key: string; value: unknown }>): Array<{ key: string; value: unknown }> {
  const list = Array.isArray(current)
    ? current.map((entry) => ({ key: String((entry as { key?: unknown })?.key || ''), value: (entry as { value?: unknown })?.value }))
      .filter((entry) => entry.key)
    : [];
  for (const entry of stored) {
    const index = list.findIndex((item) => item.key === entry.key);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }
  return list;
}

function uuidOrNull(value?: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '') ? value || null : null;
}

function missingRelation(error: unknown): boolean {
  const code = error && typeof error === 'object'
    ? (error as { driverError?: { code?: string }; code?: string }).driverError?.code
      || (error as { code?: string }).code
    : undefined;
  return code === '42P01' || code === '42703';
}
