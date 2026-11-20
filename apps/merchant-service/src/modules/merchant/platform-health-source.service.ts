import { Inject, Injectable } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';

const POS_CONFIGURATION_CATEGORIES = [
  'currency_taxes',
  'service_charges',
  'cashback_settings',
  'opening_balance',
  'cash_denominations',
  'cash_register_settings',
  'safe_and_safe_drop',
  'card_payment_settings',
  'terminal_register_mapping',
];

@Injectable()
export class PlatformHealthSourceService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async getSourceMetrics(filters: { merchant_id?: string; store_id?: string }) {
    const merchantId = filters.merchant_id?.trim() || null;
    const storeId = filters.store_id?.trim() || null;
    const dataSource = this.merchants.requireDataSource();
    const [row] = await dataSource.query(`
      WITH eligible_stores AS (
        SELECT s.id, s.merchant_id
          FROM public.stores s
         WHERE s.is_deleted = false
           AND upper(s.status::text) = 'ACTIVE'
           AND ($1::text IS NULL OR s.merchant_id::text = $1)
           AND ($2::text IS NULL OR s.id::text = $2)
      ), device_scope AS (
        SELECT DISTINCT d.id, upper(d.status::text) AS status
          FROM public.devices d
         WHERE d.is_deleted = false
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM public.store_devices sd
              WHERE sd.device_id = d.id
                AND sd.store_id = $2
                AND sd.is_mapped = true
                AND sd.is_deleted = false
           ))
           AND ($1::text IS NULL OR d.merchant_id::text = $1 OR EXISTS (
             SELECT 1
               FROM public.store_devices sd
               JOIN eligible_stores s ON s.id::text = sd.store_id
              WHERE sd.device_id = d.id
                AND sd.is_mapped = true
                AND sd.is_deleted = false
           ))
      ), store_metrics AS (
        SELECT COUNT(*)::integer AS eligible_count,
               COUNT(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM public.website_connections wc
                  WHERE wc.store_id = s.id::text
                    AND wc.status = 'CONNECTED'
               ))::integer AS synchronized_count
          FROM eligible_stores s
      ), pos_metrics AS (
        SELECT COUNT(*)::integer AS eligible_count,
               COUNT(*) FILTER (WHERE (
                 SELECT COUNT(DISTINCT c.configuration_name)
                   FROM public.store_pos_configurations c
                  WHERE c.store_id = s.id
                    AND c.configuration_name = ANY($3::text[])
               ) = cardinality($3::text[]))::integer AS completed_count
          FROM eligible_stores s
      )
      SELECT
        (SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::integer FROM device_scope) AS devices_active_count,
        (SELECT COUNT(*) FILTER (WHERE status = 'INACTIVE')::integer FROM device_scope) AS devices_inactive_count,
        (SELECT COUNT(*)::integer FROM device_scope) AS devices_eligible_count,
        store_metrics.synchronized_count AS stores_synchronized_count,
        store_metrics.eligible_count AS stores_eligible_count,
        pos_metrics.completed_count AS pos_completed_count,
        pos_metrics.eligible_count AS pos_eligible_count
      FROM store_metrics CROSS JOIN pos_metrics
    `, [merchantId, storeId, POS_CONFIGURATION_CATEGORIES]);

    return {
      devices: {
        active_count: Number(row.devices_active_count),
        inactive_count: Number(row.devices_inactive_count),
        eligible_count: Number(row.devices_eligible_count),
      },
      stores_synchronized: {
        synchronized_count: Number(row.stores_synchronized_count),
        eligible_count: Number(row.stores_eligible_count),
      },
      pos_configuration: {
        completed_count: Number(row.pos_completed_count),
        eligible_count: Number(row.pos_eligible_count),
      },
    };
  }
}
