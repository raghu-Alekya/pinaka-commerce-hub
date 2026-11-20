import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import {
  CatalogProduct,
  IssuedCouponOrder,
  IssuingCoupon,
  IssuingCouponResponse,
  catalogLookupIds,
  periodStart,
  positiveId,
  roundMoney,
  selectIssuingCoupons,
} from './issuing-coupons';

const PRODUCT_ARRAY = `
  CASE
    WHEN jsonb_typeof(catalog.payload) = 'array' THEN catalog.payload
    WHEN jsonb_typeof(catalog.payload->'products') = 'array' THEN catalog.payload->'products'
    ELSE '[]'::jsonb
  END
`;

const COMPLETED_ORDER = `
  (
    upper(COALESCE(sale.order_status, '')) = 'COMPLETED'
    OR lower(COALESCE(sale.status, '')) = 'completed'
    OR lower(COALESCE(sale.request_payload->>'status', '')) = 'completed'
  )
  AND upper(COALESCE(sale.order_status, '')) NOT IN ('REFUNDED', 'CANCELLED', 'PARTIAL_REFUND')
  AND lower(COALESCE(sale.status, '')) NOT IN ('refunded', 'cancelled', 'partial-refund', 'partially-refunded')
`;

const SHOWN_PREFIX = '_pinaka_coupon_response_shown_';

@Injectable()
export class IssuingCouponService implements OnModuleInit {
  private dataSource?: DataSource;

  async onModuleInit() {
    try {
      this.dataSource = new DataSource({ ...postgresConnectionOptions([]), synchronize: false });
      await this.dataSource.initialize();
    } catch (error: unknown) {
      this.dataSource = undefined;
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`[Loyalty Service Coupons] Database initialization failed: ${message}`);
    }
  }

  async findApplicable(
    lineItems: unknown[],
    orderTotal: number,
    storeId: string | null,
    now = new Date(),
  ): Promise<IssuingCouponResponse[]> {
    const coupons = await this.enabledCoupons(storeId);
    const products = await this.catalogProducts(lineItems, storeId);
    const issuances = await this.completedIssuances(coupons, storeId, now);
    return selectIssuingCoupons({ lineItems, orderTotal, coupons, products, issuances, now });
  }

  private database(): DataSource {
    if (!this.dataSource?.isInitialized) {
      throw new ServiceUnavailableException('Coupon database is unavailable');
    }
    return this.dataSource;
  }

  private async enabledCoupons(storeId: string | null): Promise<IssuingCoupon[]> {
    try {
      const rows: Record<string, unknown>[] = await this.database().query(
        `SELECT id::text AS id,
                store_id::text AS store_id,
                woocommerce_coupon_id::text AS woo_id,
                code,
                discount_type,
                amount,
                minimum_amount,
                maximum_amount,
                date_expires,
                usage_limit,
                usage_count,
                product_ids,
                excluded_product_ids,
                product_categories,
                excluded_product_categories,
                woocommerce_payload
           FROM public.store_coupons
          WHERE deleted_at IS NULL
            AND sync_status <> 'DELETED'
            AND ($1::uuid IS NULL OR store_id = $1::uuid)
            AND EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(woocommerce_payload->'meta_data') = 'array' THEN woocommerce_payload->'meta_data'
                    ELSE '[]'::jsonb
                  END
                ) AS meta
               WHERE meta->>'key' = '_pinaka_enable_generate_coupon'
                 AND lower(COALESCE(meta->>'value', '')) IN ('yes', 'true', '1')
            )
          ORDER BY woocommerce_coupon_id NULLS LAST, lower(code)`,
        [storeId],
      );
      return rows.map((row) => this.toCoupon(row));
    } catch (error: unknown) {
      if (this.missingRelation(error)) return [];
      throw error;
    }
  }

  private async catalogProducts(lineItems: unknown[], storeId: string | null): Promise<CatalogProduct[]> {
    const loaded = await this.findProducts(catalogLookupIds(lineItems), storeId);
    const known = new Set(loaded.map((product) => `${product.storeId}:${product.id}`));
    const parentIds = [...new Set(loaded.flatMap((product) => {
      if (!product.parentId || known.has(`${product.storeId}:${product.parentId}`)) return [];
      return [product.parentId];
    }))];
    if (parentIds.length === 0) return loaded;
    const parents = await this.findProducts(parentIds, storeId);
    return loaded.concat(parents.filter((product) => {
      const needed = loaded.some((row) => row.storeId === product.storeId && row.parentId === product.id);
      return needed && !known.has(`${product.storeId}:${product.id}`);
    }));
  }

  private async findProducts(ids: number[], storeId: string | null): Promise<CatalogProduct[]> {
    if (ids.length === 0) return [];
    try {
      const rows: Record<string, unknown>[] = await this.database().query(
        `SELECT catalog.store_id::text AS store_id,
                product->>'id' AS id,
                product->>'parent_id' AS parent_id,
                product->>'type' AS type,
                product->'categories' AS categories
           FROM public.store_products AS catalog
           CROSS JOIN LATERAL jsonb_array_elements(${PRODUCT_ARRAY}) AS product
          WHERE COALESCE(catalog.is_deleted, false) = false
            AND ($1::uuid IS NULL OR catalog.store_id = $1::uuid)
            AND product->>'id' = ANY($2::text[])`,
        [storeId, ids.map(String)],
      );
      return rows.flatMap((row) => {
        const id = positiveId(row.id);
        if (!id) return [];
        return [{
          id,
          storeId: String(row.store_id),
          parentId: positiveId(row.parent_id),
          type: String(row.type || ''),
          categoryIds: this.categoryIds(row.categories),
        }];
      });
    } catch (error: unknown) {
      if (this.missingRelation(error)) return [];
      throw error;
    }
  }

  private async completedIssuances(
    coupons: IssuingCoupon[],
    storeId: string | null,
    now: Date,
  ): Promise<IssuedCouponOrder[]> {
    const limited = coupons.filter((coupon) => coupon.generateType && coupon.generateLimit !== null && coupon.generateLimit > 0);
    if (limited.length === 0) return [];
    const earliest = limited
      .map((coupon) => periodStart(coupon.generateType, now))
      .filter((start): start is Date => start !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    if (!earliest) return [];
    const fromOrders = await this.issuancesFromOrders(storeId, earliest, now);
    const fromMeta = await this.issuancesFromOrderMeta(storeId, earliest, now);
    return fromOrders.concat(fromMeta);
  }

  private async issuancesFromOrders(storeId: string | null, after: Date, now: Date): Promise<IssuedCouponOrder[]> {
    try {
      const rows: Record<string, unknown>[] = await this.database().query(
        `SELECT sale.store_id::text AS store_id,
                sale.id::text AS order_id,
                sale.created_at AS completed_at,
                shown.meta_key
           FROM public.store_orders AS sale
           CROSS JOIN LATERAL (
             SELECT meta->>'key' AS meta_key
               FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(sale.meta_data) = 'array' THEN sale.meta_data ELSE '[]'::jsonb END
               ) AS meta
              WHERE strpos(COALESCE(meta->>'key', ''), $4) = 1
                AND lower(COALESCE(meta->>'value', '')) IN ('yes', 'true', '1')
             UNION
             SELECT meta->>'key' AS meta_key
               FROM jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(sale.request_payload->'meta_data') = 'array' THEN sale.request_payload->'meta_data'
                   ELSE '[]'::jsonb
                 END
               ) AS meta
              WHERE strpos(COALESCE(meta->>'key', ''), $4) = 1
                AND lower(COALESCE(meta->>'value', '')) IN ('yes', 'true', '1')
           ) AS shown
          WHERE sale.created_at >= $1
            AND sale.created_at <= $2
            AND ($3::uuid IS NULL OR sale.store_id = $3::uuid)
            AND ${COMPLETED_ORDER}`,
        [after, now, storeId, SHOWN_PREFIX],
      );
      return rows.flatMap((row) => this.toIssuance(row));
    } catch (error: unknown) {
      if (this.missingRelation(error)) return [];
      throw error;
    }
  }

  private async issuancesFromOrderMeta(storeId: string | null, after: Date, now: Date): Promise<IssuedCouponOrder[]> {
    try {
      const rows: Record<string, unknown>[] = await this.database().query(
        `SELECT sale.store_id::text AS store_id,
                sale.id::text AS order_id,
                sale.created_at AS completed_at,
                meta.meta_key
           FROM public.store_orders_meta AS meta
           JOIN public.store_orders AS sale ON sale.id = meta.order_id
          WHERE strpos(meta.meta_key, $4) = 1
            AND sale.created_at >= $1
            AND sale.created_at <= $2
            AND ($3::uuid IS NULL OR sale.store_id = $3::uuid)
            AND ${COMPLETED_ORDER}
            AND (
              lower(trim(both '"' from meta.meta_value::text)) IN ('yes', 'true', '1')
              OR lower(COALESCE(meta.meta_value->>'value', '')) IN ('yes', 'true', '1')
            )`,
        [after, now, storeId, SHOWN_PREFIX],
      );
      return rows.flatMap((row) => this.toIssuance(row));
    } catch (error: unknown) {
      if (this.missingRelation(error)) return [];
      throw error;
    }
  }

  private toCoupon(row: Record<string, unknown>): IssuingCoupon {
    const payload = row.woocommerce_payload && typeof row.woocommerce_payload === 'object'
      ? row.woocommerce_payload as Record<string, unknown>
      : {};
    const wooId = row.woo_id === null || row.woo_id === undefined || row.woo_id === '' ? '' : String(row.woo_id);
    return {
      id: wooId || String(row.id),
      storeId: String(row.store_id),
      code: String(row.code || ''),
      discountType: String(row.discount_type || ''),
      amount: roundMoney(Number(row.amount || 0)),
      minAmount: this.optionalMoney(row.minimum_amount),
      maxAmount: this.optionalMoney(row.maximum_amount),
      generateType: this.generateType(this.meta(payload, '_pinaka_generate_coupon_type')),
      generateLimit: this.optionalLimit(this.meta(payload, '_pinaka_generate_coupon_limit')),
      expiryDate: this.expiryDate(row.date_expires),
      enabled: true,
      usageLimit: this.optionalLimit(row.usage_limit),
      usageCount: Number(row.usage_count || 0),
      productIds: this.idList(row.product_ids),
      excludedProductIds: this.idList(row.excluded_product_ids),
      categoryIds: this.idList(row.product_categories),
      excludedCategoryIds: this.idList(row.excluded_product_categories),
    };
  }

  private toIssuance(row: Record<string, unknown>): IssuedCouponOrder[] {
    const key = String(row.meta_key || '');
    if (!key.startsWith(SHOWN_PREFIX)) return [];
    const couponId = key.slice(SHOWN_PREFIX.length).trim();
    const completedAt = row.completed_at instanceof Date ? row.completed_at : new Date(String(row.completed_at || ''));
    if (!couponId || Number.isNaN(completedAt.getTime())) return [];
    return [{
      couponId,
      storeId: String(row.store_id),
      orderId: String(row.order_id),
      orderStatus: 'completed',
      completedAt,
    }];
  }

  private meta(payload: Record<string, unknown>, key: string): unknown {
    const entries = Array.isArray(payload.meta_data) ? payload.meta_data : [];
    const match = entries.find((entry) => entry && typeof entry === 'object' && (entry as { key?: unknown }).key === key);
    return match && typeof match === 'object' ? (match as { value?: unknown }).value : undefined;
  }

  private generateType(value: unknown): string | null {
    const type = String(value || '').trim().toLowerCase();
    return GENERATE_TYPES_LIST.has(type) ? type : null;
  }

  private optionalLimit(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
  }

  private optionalMoney(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return roundMoney(parsed);
  }

  private expiryDate(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }

  private categoryIds(value: unknown): number[] {
    const entries = Array.isArray(value) ? value : [];
    return this.idList(entries.map((entry) => {
      if (entry && typeof entry === 'object') {
        const record = entry as { id?: unknown; term_id?: unknown };
        return record.id ?? record.term_id;
      }
      return entry;
    }));
  }

  private idList(value: unknown): number[] {
    const entries = Array.isArray(value) ? value : [];
    return [...new Set(entries.map((entry) => positiveId(entry)).filter((id): id is number => id !== null))];
  }

  private missingRelation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const code = (error as { driverError?: { code?: string } }).driverError?.code;
    return code === '42P01' || code === '42703';
  }
}

const GENERATE_TYPES_LIST = new Set(['daily', 'weekly', 'monthly', 'yearly']);
