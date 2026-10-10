-- Apply before deploying the POS service with the snake_case shift mapping.
BEGIN;

DO $migration$
DECLARE
  column_pair RECORD;
  has_legacy BOOLEAN;
  has_snake_case BOOLEAN;
  has_conflict BOOLEAN;
  snake_type TEXT;
BEGIN
  IF to_regclass('public.pos_shifts') IS NOT NULL THEN
    FOR column_pair IN
      SELECT *
      FROM (VALUES
        ('merchantId', 'merchant_id'),
        ('storeId', 'store_id'),
        ('registerId', 'register_id'),
        ('terminalId', 'terminal_id'),
        ('terminal_id', 'device_id'),
        ('openingDeviceId', 'opening_device_id'),
        ('openedByEmployeeId', 'opened_by_employee_id'),
        ('closedByEmployeeId', 'closed_by_employee_id'),
        ('shiftNumber', 'shift_number'),
        ('cashierName', 'cashier_name'),
        ('openingCash', 'opening_cash'),
        ('totalCashSales', 'total_cash_sales'),
        ('totalCardSales', 'total_card_sales'),
        ('totalSafeDrops', 'total_safe_drops'),
        ('totalPaidOuts', 'total_paid_outs'),
        ('closingCashActual', 'closing_cash_actual'),
        ('expectedCashInDrawer', 'expected_cash_in_drawer'),
        ('declaredCash', 'declared_cash'),
        ('cashDifference', 'cash_difference'),
        ('openingNote', 'opening_note'),
        ('closingNote', 'closing_note'),
        ('openedAt', 'opened_at'),
        ('closedAt', 'closed_at'),
        ('createdAt', 'created_at'),
        ('updatedAt', 'updated_at')
      ) AS columns(legacy_name, snake_name)
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pos_shifts'
          AND column_name = column_pair.legacy_name
      ) INTO has_legacy;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pos_shifts'
          AND column_name = column_pair.snake_name
      ) INTO has_snake_case;

      IF has_legacy AND has_snake_case THEN
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM public.pos_shifts WHERE %I IS NOT NULL AND %I IS NOT NULL AND %I::text IS DISTINCT FROM %I::text)',
          column_pair.legacy_name,
          column_pair.snake_name,
          column_pair.legacy_name,
          column_pair.snake_name
        ) INTO has_conflict;

        IF has_conflict THEN
          RAISE EXCEPTION 'Cannot migrate pos_shifts: conflicting values in "%" and "%"',
            column_pair.legacy_name, column_pair.snake_name;
        END IF;

        SELECT format_type(attribute.atttypid, attribute.atttypmod)
        INTO snake_type
        FROM pg_attribute AS attribute
        JOIN pg_class AS table_definition ON table_definition.oid = attribute.attrelid
        JOIN pg_namespace AS table_schema ON table_schema.oid = table_definition.relnamespace
        WHERE table_schema.nspname = 'public'
          AND table_definition.relname = 'pos_shifts'
          AND attribute.attname = column_pair.snake_name
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped;

        IF snake_type IS NULL THEN
          RAISE EXCEPTION 'Cannot determine the type of pos_shifts column "%"',
            column_pair.snake_name;
        END IF;

        EXECUTE format(
          'UPDATE public.pos_shifts SET %I = %I::%s WHERE %I IS NULL AND %I IS NOT NULL',
          column_pair.snake_name,
          column_pair.legacy_name,
          snake_type,
          column_pair.snake_name,
          column_pair.legacy_name
        );
        EXECUTE format(
          'ALTER TABLE public.pos_shifts DROP COLUMN %I',
          column_pair.legacy_name
        );
      ELSIF has_legacy THEN
        EXECUTE format(
          'ALTER TABLE public.pos_shifts RENAME COLUMN %I TO %I',
          column_pair.legacy_name,
          column_pair.snake_name
        );
      END IF;
    END LOOP;
  END IF;
END;
$migration$;

COMMIT;
