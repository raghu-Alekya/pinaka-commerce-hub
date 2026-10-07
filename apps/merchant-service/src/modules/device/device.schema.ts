import { DataSource } from 'typeorm';

/** Add device_id and make device_code database-generated for old and new databases. */
export async function ensureDeviceIdentitySchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 56)');
    await manager.query('ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_id text');
    await manager.query('CREATE SEQUENCE IF NOT EXISTS public.devices_device_code_seq START WITH 1');
    await manager.query(`
      SELECT setval(
        'public.devices_device_code_seq',
        GREATEST(
          (SELECT last_value FROM public.devices_device_code_seq),
          COALESCE((
            SELECT MAX(substring(device_code FROM 5)::bigint)
            FROM public.devices
            WHERE device_code ~ '^DVC_[0-9]+$'
          ), 0),
          1
        ),
        (SELECT is_called FROM public.devices_device_code_seq) OR EXISTS (
          SELECT 1 FROM public.devices WHERE device_code ~ '^DVC_[0-9]+$'
        )
      )
    `);
    await manager.query(`
      ALTER TABLE public.devices
      ALTER COLUMN device_code SET DEFAULT
        ('DVC_' || lpad(nextval('public.devices_device_code_seq')::text, 5, '0'))
    `);
  });
}

export async function ensureMerchantDevicesSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 55)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.merchant_devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id uuid NOT NULL,
        merchant_id varchar(100) NOT NULL,
        created_by varchar(100),
        updated_by varchar(100),
        is_deleted boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await manager.query(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.merchant_devices'::regclass
            AND confrelid = 'public.devices'::regclass
            AND contype = 'f'
        ) THEN
          ALTER TABLE public.merchant_devices
            ADD CONSTRAINT fk_merchant_devices_device_id
            FOREIGN KEY (device_id) REFERENCES public.devices(id);
        END IF;
      END
      $migration$
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS idx_merchant_devices_merchant_id
      ON public.merchant_devices (merchant_id) WHERE is_deleted = false
    `);
    await manager.query(`
      CREATE INDEX IF NOT EXISTS idx_merchant_devices_device_id
      ON public.merchant_devices (device_id) WHERE is_deleted = false
    `);
    await manager.query(`
      INSERT INTO public.merchant_devices (device_id, merchant_id, created_by, updated_by)
      SELECT d.id,
             COALESCE(NULLIF(to_jsonb(d)->>'merchant_id', ''), NULLIF(to_jsonb(d)->>'merchantId', '')),
             NULLIF(COALESCE(to_jsonb(d)->>'created_by', to_jsonb(d)->>'createdBy'), ''),
             NULLIF(COALESCE(to_jsonb(d)->>'updated_by', to_jsonb(d)->>'updatedBy'), '')
      FROM public.devices d
      WHERE COALESCE(NULLIF(to_jsonb(d)->>'merchant_id', ''), NULLIF(to_jsonb(d)->>'merchantId', '')) IS NOT NULL
        AND COALESCE((to_jsonb(d)->>'is_deleted')::boolean, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.merchant_devices md
          WHERE md.device_id = d.id
        )
    `);
  });
}
