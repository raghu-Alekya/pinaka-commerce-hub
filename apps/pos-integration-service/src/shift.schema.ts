import { DataSource } from 'typeorm';

const LEGACY_SHIFT_COLUMNS = [
  'register_id', 'registerId',
  'opened_by_employee_id', 'openedByEmployeeId',
  'closed_by_employee_id', 'closedByEmployeeId',
  'closed_by_device_id',
  'shift_number', 'shiftNumber',
  'cashier_name', 'cashierName',
  'opening_cash', 'openingCash',
  'total_cash_sales', 'totalCashSales',
  'total_card_sales', 'totalCardSales',
  'total_safe_drops', 'totalSafeDrops',
  'total_paid_outs', 'totalPaidOuts',
  'total_orders',
  'total_order_sale_amount',
  'total_cashback',
  'total_payouts',
  'total_ebt_sales',
  'total_pay_later',
  'total_refunds',
  'total_cancelled_orders',
  'total_void_items',
  'drawer_denominations',
  'drawer_total_amount',
  'tube_denominations',
  'tube_total_amount',
  'total_amount',
  'closing_cash_actual', 'closingCashActual',
  'expected_cash_in_drawer', 'expectedCashInDrawer',
  'cash_difference', 'cashDifference',
  'opening_note', 'openingNote',
  'closing_note', 'closingNote',
];

export async function ensureShiftSplitSchema(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_by VARCHAR(100);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_device_id VARCHAR(100);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(12,2);
    ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS over_short DECIMAL(12,2);
  `);

  await dataSource.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts'
          AND column_name = 'opening_device_id' AND udt_name = 'uuid'
      ) THEN
        ALTER TABLE public.pos_shifts
          ALTER COLUMN opening_device_id TYPE VARCHAR(100) USING opening_device_id::text;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'opening_device_id'
      ) THEN
        ALTER TABLE public.pos_shifts ADD COLUMN opening_device_id VARCHAR(100);
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashier_name'
      ) THEN
        ALTER TABLE public.pos_shifts ALTER COLUMN cashier_name DROP NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'declared_cash'
      ) THEN
        ALTER TABLE public.pos_shifts ALTER COLUMN declared_cash TYPE DECIMAL(12,2);
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'discrepancy'
      ) THEN
        ALTER TABLE public.pos_shifts ALTER COLUMN discrepancy TYPE DECIMAL(12,2);
      END IF;
    END $$;
  `);

  await dataSource.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'opening_cash'
      ) THEN
        UPDATE public.pos_shifts
           SET opening_balance = COALESCE(opening_balance, opening_cash, 0)
         WHERE opening_balance IS NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closing_cash_actual'
      ) THEN
        UPDATE public.pos_shifts
           SET closing_balance = COALESCE(closing_balance, closing_cash_actual)
         WHERE closing_balance IS NULL AND closing_cash_actual IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cash_difference'
      ) THEN
        UPDATE public.pos_shifts
           SET over_short = COALESCE(over_short, cash_difference, discrepancy)
         WHERE over_short IS NULL AND (cash_difference IS NOT NULL OR discrepancy IS NOT NULL);
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'discrepancy'
      ) THEN
        UPDATE public.pos_shifts
           SET over_short = COALESCE(over_short, discrepancy)
         WHERE over_short IS NULL AND discrepancy IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closed_by_device_id'
      ) THEN
        UPDATE public.pos_shifts
           SET closing_device_id = COALESCE(closing_device_id, closed_by_device_id)
         WHERE closing_device_id IS NULL AND closed_by_device_id IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'opened_by_employee_id'
      ) THEN
        UPDATE public.pos_shifts
           SET created_by = COALESCE(created_by, opened_by_employee_id::text)
         WHERE created_by IS NULL AND opened_by_employee_id IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closed_by_employee_id'
      ) THEN
        UPDATE public.pos_shifts
           SET closed_by = COALESCE(closed_by, closed_by_employee_id::text),
               updated_by = COALESCE(updated_by, closed_by_employee_id::text)
         WHERE closed_by_employee_id IS NOT NULL
           AND (closed_by IS NULL OR updated_by IS NULL);
      END IF;
    END $$;
    UPDATE public.pos_shifts SET opening_balance = 0 WHERE opening_balance IS NULL;
    ALTER TABLE public.pos_shifts ALTER COLUMN opening_balance SET DEFAULT 0;
    ALTER TABLE public.pos_shifts ALTER COLUMN opening_balance SET NOT NULL;
  `);

  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS public.pos_shift_meta (
      id UUID PRIMARY KEY,
      shift_id VARCHAR(100) NOT NULL,
      meta_name VARCHAR(100) NOT NULL,
      meta_value JSONB NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE TABLE IF NOT EXISTS public.pos_shift_transactions (
      id UUID PRIMARY KEY,
      shift_id VARCHAR(100) NOT NULL,
      transaction_type VARCHAR(50) NOT NULL,
      total_sum DECIMAL(12,2) NOT NULL,
      json_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by VARCHAR(100),
      updated_by VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_meta_shift_name_uq
      ON public.pos_shift_meta (shift_id, meta_name);
    CREATE INDEX IF NOT EXISTS pos_shift_meta_shift_idx ON public.pos_shift_meta (shift_id);
    CREATE INDEX IF NOT EXISTS pos_shift_transactions_shift_type_idx
      ON public.pos_shift_transactions (shift_id, transaction_type);
    CREATE INDEX IF NOT EXISTS pos_shifts_store_status_idx ON public.pos_shifts (store_id, status);
  `);

  await dataSource.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shift_meta_status_chk') THEN
        ALTER TABLE public.pos_shift_meta
          ADD CONSTRAINT pos_shift_meta_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shift_transactions_status_chk') THEN
        ALTER TABLE public.pos_shift_transactions
          ADD CONSTRAINT pos_shift_transactions_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shift_meta_shift_fk') THEN
        ALTER TABLE public.pos_shift_meta
          ADD CONSTRAINT pos_shift_meta_shift_fk
          FOREIGN KEY (shift_id) REFERENCES public.pos_shifts (id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shift_transactions_shift_fk') THEN
        ALTER TABLE public.pos_shift_transactions
          ADD CONSTRAINT pos_shift_transactions_shift_fk
          FOREIGN KEY (shift_id) REFERENCES public.pos_shifts (id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await dataSource.query(`
    DO $$
    DECLARE
      spec RECORD;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashierName'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashier_name'
      ) THEN
        UPDATE public.pos_shifts
           SET cashier_name = "cashierName"
         WHERE (cashier_name IS NULL OR btrim(cashier_name) = '') AND "cashierName" IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'openingNote'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'opening_note'
      ) THEN
        UPDATE public.pos_shifts
           SET opening_note = "openingNote"
         WHERE opening_note IS NULL AND "openingNote" IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closingNote'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closing_note'
      ) THEN
        UPDATE public.pos_shifts
           SET closing_note = "closingNote"
         WHERE closing_note IS NULL AND "closingNote" IS NOT NULL;
      END IF;

      FOR spec IN
        SELECT * FROM (VALUES
          ('cashier_name', 'text'),
          ('opening_note', 'text'),
          ('closing_note', 'text'),
          ('shift_number', 'text'),
          ('register_id', 'uuid'),
          ('drawer_denominations', 'jsonb'),
          ('tube_denominations', 'jsonb'),
          ('drawer_total_amount', 'number'),
          ('tube_total_amount', 'number'),
          ('total_amount', 'number'),
          ('total_order_sale_amount', 'number'),
          ('total_orders', 'count'),
          ('total_cancelled_orders', 'count'),
          ('total_void_items', 'count')
        ) AS fields(meta_name, kind)
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = spec.meta_name
        ) THEN
          IF spec.kind = 'text' THEN
            EXECUTE format($migrate$
              INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
              SELECT gen_random_uuid(), s.id, %L, to_jsonb(s.%I), 'ACTIVE'
              FROM public.pos_shifts s
              WHERE s.%I IS NOT NULL AND btrim(s.%I::text) <> ''
                AND NOT EXISTS (
                  SELECT 1 FROM public.pos_shift_meta m
                  WHERE m.shift_id = s.id AND m.meta_name = %L
                )
            $migrate$, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name);
          ELSIF spec.kind = 'uuid' THEN
            EXECUTE format($migrate$
              INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
              SELECT gen_random_uuid(), s.id, %L, to_jsonb(s.%I::text), 'ACTIVE'
              FROM public.pos_shifts s
              WHERE s.%I IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM public.pos_shift_meta m
                  WHERE m.shift_id = s.id AND m.meta_name = %L
                )
            $migrate$, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name);
          ELSIF spec.kind = 'jsonb' THEN
            EXECUTE format($migrate$
              INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
              SELECT gen_random_uuid(), s.id, %L, s.%I, 'ACTIVE'
              FROM public.pos_shifts s
              WHERE s.%I IS NOT NULL AND s.%I <> 'null'::jsonb
                AND NOT EXISTS (
                  SELECT 1 FROM public.pos_shift_meta m
                  WHERE m.shift_id = s.id AND m.meta_name = %L
                )
            $migrate$, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name);
          ELSIF spec.kind = 'count' THEN
            EXECUTE format($migrate$
              INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
              SELECT gen_random_uuid(), s.id, %L, to_jsonb(s.%I), 'ACTIVE'
              FROM public.pos_shifts s
              WHERE s.%I IS NOT NULL AND s.%I::numeric <> 0
                AND NOT EXISTS (
                  SELECT 1 FROM public.pos_shift_meta m
                  WHERE m.shift_id = s.id AND m.meta_name = %L
                )
            $migrate$, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name);
          ELSE
            EXECUTE format($migrate$
              INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
              SELECT gen_random_uuid(), s.id, %L, to_jsonb(s.%I), 'ACTIVE'
              FROM public.pos_shifts s
              WHERE s.%I IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM public.pos_shift_meta m
                  WHERE m.shift_id = s.id AND m.meta_name = %L
                )
            $migrate$, spec.meta_name, spec.meta_name, spec.meta_name, spec.meta_name);
          END IF;
        END IF;
      END LOOP;

      FOR spec IN
        SELECT * FROM (VALUES
          ('CASH_SALE', 'total_cash_sales'),
          ('CARD_SALE', 'total_card_sales'),
          ('SAFE_DROP', 'total_safe_drops'),
          ('PAID_OUT', 'total_paid_outs'),
          ('CASHBACK', 'total_cashback'),
          ('PAYOUT', 'total_payouts'),
          ('EBT_SALE', 'total_ebt_sales'),
          ('PAY_LATER', 'total_pay_later'),
          ('REFUND', 'total_refunds')
        ) AS totals(transaction_type, column_name)
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = spec.column_name
        ) THEN
          EXECUTE format($migrate$
            INSERT INTO public.pos_shift_transactions (
              id, shift_id, transaction_type, total_sum, json_payload, status, created_by, updated_by, created_at, updated_at
            )
            SELECT gen_random_uuid(), s.id, %L,
              s.%I - COALESCE((
                SELECT SUM(t.total_sum) FROM public.pos_shift_transactions t
                WHERE t.shift_id = s.id AND t.transaction_type = %L AND t.status = 'ACTIVE'
              ), 0),
              '{"source":"legacy_shift_total"}'::jsonb,
              'ACTIVE', s.created_by, s.updated_by,
              COALESCE(s.opened_at, s.created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
            FROM public.pos_shifts s
            WHERE s.%I IS NOT NULL
              AND s.%I - COALESCE((
                SELECT SUM(t.total_sum) FROM public.pos_shift_transactions t
                WHERE t.shift_id = s.id AND t.transaction_type = %L AND t.status = 'ACTIVE'
              ), 0) > 0
              AND NOT EXISTS (
                SELECT 1 FROM public.pos_shift_transactions t
                WHERE t.shift_id = s.id AND t.transaction_type = %L
                  AND t.json_payload->>'source' = 'legacy_shift_total'
              )
          $migrate$,
            spec.transaction_type, spec.column_name, spec.transaction_type,
            spec.column_name, spec.column_name, spec.transaction_type, spec.transaction_type);
        END IF;
      END LOOP;
    END $$;
  `);

  await dataSource.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashierName'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashier_name'
      ) THEN
        INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
        SELECT gen_random_uuid(), s.id, 'cashier_name', to_jsonb(s."cashierName"), 'ACTIVE'
        FROM public.pos_shifts s
        WHERE s."cashierName" IS NOT NULL AND btrim(s."cashierName") <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public.pos_shift_meta m
            WHERE m.shift_id = s.id AND m.meta_name = 'cashier_name'
          );
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'openingNote'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'opening_note'
      ) THEN
        INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
        SELECT gen_random_uuid(), s.id, 'opening_note', to_jsonb(s."openingNote"), 'ACTIVE'
        FROM public.pos_shifts s
        WHERE s."openingNote" IS NOT NULL AND btrim(s."openingNote") <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public.pos_shift_meta m
            WHERE m.shift_id = s.id AND m.meta_name = 'opening_note'
          );
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closingNote'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'closing_note'
      ) THEN
        INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
        SELECT gen_random_uuid(), s.id, 'closing_note', to_jsonb(s."closingNote"), 'ACTIVE'
        FROM public.pos_shifts s
        WHERE s."closingNote" IS NOT NULL AND btrim(s."closingNote") <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public.pos_shift_meta m
            WHERE m.shift_id = s.id AND m.meta_name = 'closing_note'
          );
      END IF;
    END $$;
  `);

  const legacyList = LEGACY_SHIFT_COLUMNS.map((column) => `'${column}'`).join(', ');
  await dataSource.query(`
    DO $$
    DECLARE
      legacy_column text;
    BEGIN
      FOR legacy_column IN
        SELECT unnest(ARRAY[${legacyList}]::text[])
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = legacy_column
        ) THEN
          EXECUTE format('ALTER TABLE public.pos_shifts DROP COLUMN %I', legacy_column);
        END IF;
      END LOOP;
    END $$;
  `);
}
