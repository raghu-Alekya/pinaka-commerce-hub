import { DataSource } from 'typeorm';

/** Creates the store/device link table; parent ownership is validated by the service. */
export async function ensureStoreDevicesSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 54)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.store_devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar(100) NOT NULL,
        device_id uuid NOT NULL REFERENCES public.devices(id),
        merchant_id varchar(100) NOT NULL,
        is_mapped boolean NOT NULL DEFAULT true,
        created_by varchar(100),
        updated_by varchar(100),
        is_deleted boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_devices_store_id_idx ON public.store_devices (store_id)`);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_devices_device_id_idx ON public.store_devices (device_id)`);
    await manager.query(`CREATE INDEX IF NOT EXISTS store_devices_merchant_id_idx ON public.store_devices (merchant_id)`);
  });
}
