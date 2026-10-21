import { DataSource } from 'typeorm';

export async function ensureStorePosPaymentsSchema(db: DataSource): Promise<void> {
  await db.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 53)');
    await manager.query(`
      DO $enum$
      BEGIN
        CREATE TYPE public.store_pos_payment_type AS ENUM (
          'pos_payment',
          'vendor_payment'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $enum$
    `);
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_pos_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES public.store_orders(order_id) ON DELETE CASCADE,
        merchant_id uuid NOT NULL,
        store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
        local_id varchar(150),
        client_order_id varchar(150),
        device_id varchar(150),
        shift_id varchar(150),
        user_id varchar(150),
        payment_type public.store_pos_payment_type NOT NULL,
        payment_method varchar(100) NOT NULL,
        payment_method_title varchar(150),
        amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
        order_total numeric(12, 2) NOT NULL CHECK (order_total >= 0),
        remaining numeric(12, 2) NOT NULL DEFAULT 0 CHECK (remaining >= 0),
        refund_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
        currency varchar(3),
        status varchar(50) NOT NULL DEFAULT 'completed',
        entry_type varchar(20) NOT NULL DEFAULT 'payment'
          CHECK (entry_type IN ('payment', 'refund', 'void')),
        is_void boolean NOT NULL DEFAULT false,
        provider varchar(100),
        provider_transaction_id varchar(255),
        payment_at timestamptz NOT NULL DEFAULT now(),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        ADD COLUMN IF NOT EXISTS refund_amount numeric(12, 2) NOT NULL DEFAULT 0
    `);
    await manager.query(`
      DO $json_migration$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'store_pos_payments'
             AND column_name = 'raw_payload'
        ) THEN
          EXECUTE $sql$
            UPDATE public.store_pos_payments
               SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('source_payload', raw_payload)
             WHERE raw_payload IS NOT NULL
               AND raw_payload <> '{}'::jsonb
               AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'source_payload')
          $sql$;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'store_pos_payments'
             AND column_name = 'provider_response'
        ) THEN
          EXECUTE $sql$
            UPDATE public.store_pos_payments
               SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('provider_response', provider_response)
             WHERE provider_response IS NOT NULL
               AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'provider_response')
          $sql$;
        END IF;
      END
      $json_migration$
    `);
    // `balance_amount` duplicated `remaining`. Preserve the calculated value
    // in the canonical column, then remove all obsolete physical columns.
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        DROP CONSTRAINT IF EXISTS store_pos_payments_balance_consistent_ck
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET remaining = GREATEST(0, amount - refund_amount)
       WHERE remaining IS DISTINCT FROM GREATEST(0, amount - refund_amount)
    `);
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        DROP COLUMN IF EXISTS balance_amount,
        DROP COLUMN IF EXISTS parent_payment_id,
        DROP COLUMN IF EXISTS provider_response,
        DROP COLUMN IF EXISTS raw_payload
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET payment_method = lower(btrim(payment_method)),
             currency = NULLIF(upper(btrim(currency)), ''),
             status = lower(btrim(status)),
             updated_at = CASE
               WHEN payment_method IS DISTINCT FROM lower(btrim(payment_method))
                 OR currency IS DISTINCT FROM NULLIF(upper(btrim(currency)), '')
                 OR status IS DISTINCT FROM lower(btrim(status))
               THEN now() ELSE updated_at END
       WHERE payment_method IS DISTINCT FROM lower(btrim(payment_method))
          OR currency IS DISTINCT FROM NULLIF(upper(btrim(currency)), '')
          OR status IS DISTINCT FROM lower(btrim(status))
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET payment_at = created_at,
             updated_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('original_unzoned_payment_at', metadata->'source_payload'->>'created_at')
       WHERE metadata->'source_payload' ? 'created_at'
         AND metadata->'source_payload'->>'created_at' !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
         AND payment_at > created_at + interval '5 minutes'
    `);
    await manager.query(`
      WITH missing AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY order_id ORDER BY payment_at, created_at, id
               ) AS payment_number
          FROM public.store_pos_payments
         WHERE entry_type = 'payment'
           AND deleted_at IS NULL
           AND NULLIF(btrim(local_id), '') IS NULL
      )
      UPDATE public.store_pos_payments AS payment
         SET local_id = 'generated:' || missing.payment_number::text,
             metadata = COALESCE(payment.metadata, '{}'::jsonb)
               || jsonb_build_object('generated_local_id', true),
             updated_at = now()
        FROM missing
       WHERE payment.id = missing.id
    `);
    await manager.query(`
      UPDATE public.store_pos_payments AS payment
         SET device_id = sale.device_id,
             metadata = COALESCE(payment.metadata, '{}'::jsonb)
               || jsonb_build_object('device_id_backfilled_from_order', true),
             updated_at = now()
        FROM public.store_orders AS sale
       WHERE sale.order_id = payment.order_id
         AND NULLIF(btrim(payment.device_id), '') IS NULL
         AND NULLIF(btrim(sale.device_id), '') IS NOT NULL
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('device_id_missing_source', true),
             updated_at = now()
       WHERE entry_type = 'payment'
         AND deleted_at IS NULL
         AND NULLIF(btrim(device_id), '') IS NULL
         AND COALESCE(metadata->>'device_id_missing_source', 'false') <> 'true'
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET refund_amount = amount,
             remaining = 0
       WHERE entry_type = 'refund'
         AND refund_amount = 0
    `);
    await manager.query(`
      UPDATE public.store_pos_payments
         SET remaining = GREATEST(0, amount - refund_amount),
             updated_at = now()
       WHERE remaining IS DISTINCT FROM GREATEST(0, amount - refund_amount)
    `);
    // Some pre-payment-ledger orders have refund rows but no captured payment
    // row. Reconstruct their single original payment from the immutable order
    // snapshot before consolidating the refund history.
    await manager.query(`
      INSERT INTO public.store_pos_payments (
        order_id, merchant_id, store_id, local_id, client_order_id, device_id,
        shift_id, user_id, payment_type, payment_method, payment_method_title,
        amount, order_total, remaining, refund_amount, currency,
        status, entry_type, payment_at, metadata
      )
      SELECT sale.order_id, sale.merchant_id, sale.store_id,
             'legacy-payment:' || sale.order_id::text, sale.client_order_id,
             sale.device_id, sale.shift_id, sale.placed_by, 'pos_payment',
             COALESCE(NULLIF(sale.payment_method, ''), 'cash'),
             sale.payment_method_title, sale.total, sale.total, sale.total, 0,
             sale.currency, 'completed', 'payment', sale.created_at,
             jsonb_build_object(
               'inferred_legacy_payment', true,
               'source_payload', jsonb_build_object(
                 'source', 'store_orders',
                 'payments', COALESCE(sale.payments, '[]'::jsonb)
               )
             )
        FROM public.store_orders AS sale
       WHERE EXISTS (
         SELECT 1 FROM public.store_pos_payments AS refund
          WHERE refund.order_id = sale.order_id
            AND refund.entry_type = 'refund' AND refund.deleted_at IS NULL
       )
         AND NOT EXISTS (
           SELECT 1 FROM public.store_pos_payments AS payment
            WHERE payment.order_id = sale.order_id
              AND payment.entry_type = 'payment' AND payment.deleted_at IS NULL
         )
    `);
    // Consolidate legacy refund rows into their original payment rows. The old
    // rows are soft-deleted (not destroyed), so the database backup and the row
    // itself both remain available for audit/recovery.
    await manager.query(`
      DO $migration$
      DECLARE
        legacy record;
        payment record;
        outstanding numeric(12, 2);
        available numeric(12, 2);
        allocated numeric(12, 2);
        event jsonb;
      BEGIN
        FOR legacy IN
          SELECT *
            FROM public.store_pos_payments
           WHERE entry_type = 'refund'
             AND is_void = false
             AND deleted_at IS NULL
             AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled', 'migrated')
           ORDER BY created_at, id
           FOR UPDATE
        LOOP
          outstanding := legacy.amount;
          FOR payment IN
            SELECT id, amount, refund_amount
              FROM public.store_pos_payments
             WHERE order_id = legacy.order_id
               AND entry_type = 'payment'
               AND is_void = false
               AND deleted_at IS NULL
               AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled')
             ORDER BY payment_at, created_at, id
             FOR UPDATE
          LOOP
            available := GREATEST(0, payment.amount - payment.refund_amount);
            allocated := LEAST(outstanding, available);
            IF allocated > 0 THEN
              event := COALESCE(legacy.metadata, '{}'::jsonb)
                || jsonb_build_object(
                  'refund_id', legacy.id,
                  'legacy_refund_id', legacy.id,
                  'payment_id', payment.id,
                  'amount', allocated,
                  'order_refund_amount', legacy.amount,
                  'created_at', legacy.payment_at,
                  'raw_payload', legacy.metadata->'source_payload'
                );
              UPDATE public.store_pos_payments
                 SET refund_amount = LEAST(amount, refund_amount + allocated),
                     remaining = GREATEST(0, amount - (refund_amount + allocated)),
                     status = CASE
                       WHEN refund_amount + allocated >= amount THEN 'refunded'
                       ELSE 'partially-refunded'
                     END,
                     metadata = jsonb_set(
                       COALESCE(metadata, '{}'::jsonb),
                       '{refund_history}',
                       COALESCE(metadata->'refund_history', '[]'::jsonb) || jsonb_build_array(event),
                       true
                     ),
                     updated_at = now()
               WHERE id = payment.id;
              outstanding := outstanding - allocated;
            END IF;
            EXIT WHEN outstanding <= 0.005;
          END LOOP;
          IF outstanding <= 0.005 THEN
            UPDATE public.store_pos_payments
               SET status = 'migrated', deleted_at = now(), updated_at = now()
             WHERE id = legacy.id;
          END IF;
        END LOOP;
      END
      $migration$
    `);
    await manager.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS store_pos_payments_sync_uidx
      ON public.store_pos_payments (store_id, order_id, device_id, local_id)
      WHERE local_id IS NOT NULL AND deleted_at IS NULL
    `);
    await manager.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS store_pos_payments_sync_nullsafe_uidx
      ON public.store_pos_payments (
        store_id, order_id, COALESCE(device_id, ''), local_id
      )
      WHERE local_id IS NOT NULL AND deleted_at IS NULL
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS store_pos_payments_store_time_idx
      ON public.store_pos_payments (merchant_id, store_id, payment_at DESC)
      WHERE deleted_at IS NULL
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS store_pos_payments_order_idx
      ON public.store_pos_payments (order_id)
      WHERE deleted_at IS NULL
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS store_pos_payments_shift_idx
      ON public.store_pos_payments (store_id, shift_id, payment_at DESC)
      WHERE deleted_at IS NULL
    `);
    // Constraints protect the canonical refund columns after duplicate and
    // obsolete columns have been consolidated above.
    await manager.query(`
      DO $constraints$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'store_pos_payments_refund_lte_amount_ck'
        ) THEN
          ALTER TABLE public.store_pos_payments
            ADD CONSTRAINT store_pos_payments_refund_lte_amount_ck
            CHECK (refund_amount <= amount) NOT VALID;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'store_pos_payments_remaining_consistent_ck'
        ) THEN
          ALTER TABLE public.store_pos_payments
            ADD CONSTRAINT store_pos_payments_remaining_consistent_ck
            CHECK (remaining = amount - refund_amount) NOT VALID;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'store_pos_payments_active_local_id_ck'
        ) THEN
          ALTER TABLE public.store_pos_payments
            ADD CONSTRAINT store_pos_payments_active_local_id_ck
            CHECK (
              entry_type <> 'payment' OR deleted_at IS NOT NULL
              OR NULLIF(btrim(local_id), '') IS NOT NULL
            ) NOT VALID;
        END IF;
      END
      $constraints$
    `);
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        VALIDATE CONSTRAINT store_pos_payments_refund_lte_amount_ck
    `);
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        VALIDATE CONSTRAINT store_pos_payments_remaining_consistent_ck
    `);
    await manager.query(`
      ALTER TABLE public.store_pos_payments
        VALIDATE CONSTRAINT store_pos_payments_active_local_id_ck
    `);
  });
}
