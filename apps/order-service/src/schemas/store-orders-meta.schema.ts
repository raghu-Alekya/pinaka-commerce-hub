import { DataSource } from 'typeorm';

const ORDER_META_ENTRIES = `
  SELECT sale.order_id, NULLIF(btrim(entry->>'key'), '') AS meta_key, entry->'value' AS meta_value
    FROM public.store_orders AS sale
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(sale.meta_data) = 'array' AND jsonb_array_length(sale.meta_data) > 0 THEN sale.meta_data
        WHEN jsonb_typeof(sale.metadata) = 'array' THEN sale.metadata
        ELSE '[]'::jsonb
      END
    ) AS entry
`;

export async function ensureStoreOrdersMetaSchema(db: DataSource): Promise<void> {
  await db.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 61)');
    const orders = await manager.query(`SELECT to_regclass('public.store_orders') AS name`);
    if (!orders[0]?.name) return;

    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_orders_meta (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES public.store_orders(order_id) ON DELETE CASCADE,
        meta_key varchar(191) NOT NULL,
        meta_value jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT store_orders_meta_order_key_uidx UNIQUE (order_id, meta_key)
      )
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS store_orders_meta_order_id_idx
      ON public.store_orders_meta (order_id)
    `);

    await manager.query(`
      INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
      ${ORDER_META_ENTRIES}
      WHERE NULLIF(btrim(entry->>'key'), '') IS NOT NULL
        AND entry->'value' IS NOT NULL
      ON CONFLICT (order_id, meta_key) DO NOTHING
    `);

    const payments = await manager.query(`SELECT to_regclass('public.store_pos_payments') AS name`);
    if (payments[0]?.name) {
      await manager.query(`
        INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
        SELECT tendered.order_id, 'pos_change_returned', to_jsonb(tendered.change_amount)
          FROM (
            SELECT payment.order_id,
                   ROUND(GREATEST(0, SUM(payment.amount) - MAX(GREATEST(payment.order_total, 0))), 2) AS change_amount,
                   SUM(payment.amount) FILTER (
                     WHERE lower(replace(payment.payment_method, '_', '-')) IN ('cash', 'pos-cash')
                   ) AS cash_amount
              FROM public.store_pos_payments AS payment
             WHERE payment.entry_type = 'payment'
               AND payment.deleted_at IS NULL
               AND payment.is_void = false
               AND lower(COALESCE(payment.status, 'completed')) IN ('completed', 'pending')
             GROUP BY payment.order_id
          ) AS tendered
         WHERE tendered.cash_amount > 0
           AND tendered.change_amount > 0
        ON CONFLICT (order_id, meta_key) DO NOTHING
      `);
      await manager.query(`
        INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
        SELECT payment.order_id,
               'pos_cash_received',
               to_jsonb(ROUND(SUM(payment.amount), 2))
          FROM public.store_pos_payments AS payment
         WHERE payment.entry_type = 'payment'
           AND payment.deleted_at IS NULL
           AND payment.is_void = false
           AND lower(COALESCE(payment.status, 'completed')) IN ('completed', 'pending')
           AND lower(replace(payment.payment_method, '_', '-')) IN ('cash', 'pos-cash')
         GROUP BY payment.order_id
        HAVING SUM(payment.amount) > 0
        ON CONFLICT (order_id, meta_key) DO NOTHING
      `);
      await manager.query(`
        UPDATE public.store_pos_payments AS payment
           SET metadata = COALESCE(payment.metadata, '{}'::jsonb)
                 || jsonb_build_object('pos_change_returned', meta.meta_value),
               updated_at = now()
          FROM public.store_orders_meta AS meta
         WHERE meta.meta_key = 'pos_change_returned'
           AND meta.order_id = payment.order_id
           AND payment.id = (
             SELECT cash.id
               FROM public.store_pos_payments AS cash
              WHERE cash.order_id = payment.order_id
                AND cash.entry_type = 'payment'
                AND cash.deleted_at IS NULL
                AND cash.is_void = false
                AND lower(replace(cash.payment_method, '_', '-')) IN ('cash', 'pos-cash')
              ORDER BY cash.payment_at DESC, cash.created_at DESC
              LIMIT 1
           )
           AND NOT (COALESCE(payment.metadata, '{}'::jsonb) ? 'pos_change_returned')
      `);
    }

    await manager.query(`
      UPDATE public.store_orders AS sale
         SET metadata = COALESCE(sale.metadata, '[]'::jsonb) || missing.entries,
             meta_data = COALESCE(sale.meta_data, '[]'::jsonb) || missing.entries,
             updated_at = now()
        FROM (
          SELECT meta.order_id,
                 jsonb_agg(jsonb_build_object('key', meta.meta_key, 'value', meta.meta_value)) AS entries
            FROM public.store_orders_meta AS meta
            JOIN public.store_orders AS sale_row ON sale_row.order_id = meta.order_id
           WHERE meta.meta_key IN ('pos_change_returned', 'pos_cash_received')
             AND NOT EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(COALESCE(sale_row.metadata, '[]'::jsonb)) AS entry
                WHERE entry->>'key' = meta.meta_key
             )
           GROUP BY meta.order_id
        ) AS missing
       WHERE missing.order_id = sale.order_id
    `);
  });
}
