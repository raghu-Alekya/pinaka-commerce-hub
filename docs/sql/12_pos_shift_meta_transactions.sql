-- Split POS shifts into a master row, key-value metadata, and financial transactions.
-- Safe to run more than once against a database that already has public.pos_shifts.

BEGIN;

ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_by VARCHAR(100);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_device_id VARCHAR(100);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(12,2);
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS over_short DECIMAL(12,2);

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
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = 'cashier_name'
  ) THEN
    ALTER TABLE public.pos_shifts ALTER COLUMN cashier_name DROP NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pos_shift_meta (
  id UUID PRIMARY KEY,
  shift_id VARCHAR(100) NOT NULL,
  meta_name VARCHAR(100) NOT NULL,
  meta_value JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pos_shift_meta_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pos_shift_transactions_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_meta_shift_name_uq
  ON public.pos_shift_meta (shift_id, meta_name);
CREATE INDEX IF NOT EXISTS pos_shift_meta_shift_idx
  ON public.pos_shift_meta (shift_id);
CREATE INDEX IF NOT EXISTS pos_shift_transactions_shift_type_idx
  ON public.pos_shift_transactions (shift_id, transaction_type);
CREATE INDEX IF NOT EXISTS pos_shifts_store_status_idx
  ON public.pos_shifts (store_id, status);

DO $$
BEGIN
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

COMMENT ON TABLE public.pos_shifts IS
  'Master cashier shift. Notes, denominations, and sale totals live in pos_shift_meta and pos_shift_transactions.';
COMMENT ON COLUMN public.pos_shift_meta.meta_value IS
  'JSON value: string, number, boolean, array, or object. Examples: opening_note, closing_note, drawer_denominations, tube_denominations, drawer_total_amount, tube_total_amount.';
COMMENT ON COLUMN public.pos_shift_transactions.transaction_type IS
  'Examples: SAFE_DROP, VENDOR_PAYMENT, PAID_OUT, PAID_IN, CASH_SALE, CARD_SALE, EBT_SALE, REFUND, CASHBACK, PAYOUT, PAY_LATER.';
COMMENT ON COLUMN public.pos_shift_transactions.json_payload IS
  'Transaction detail such as vendor, invoice, denomination breakdown, or tender lines.';

COMMIT;
