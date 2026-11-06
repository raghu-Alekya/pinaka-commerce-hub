import { DataSource } from 'typeorm';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStoreUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function readPosConfigDocument(
  db: DataSource,
  storeId: string,
  configurationName: string,
): Promise<Record<string, any> | null> {
  if (!isStoreUuid(storeId)) return null;
  const rows: Array<{ id: string; configuration_value: unknown; created_at: Date; updated_at: Date }> = await db.query(
    `SELECT id::text AS id, configuration_value, created_at, updated_at
       FROM public.store_pos_configurations
      WHERE store_id = $1::uuid AND configuration_name = $2
      LIMIT 1`,
    [storeId, configurationName],
  );
  const row = rows[0];
  if (!row) return null;
  const value = row.configuration_value && typeof row.configuration_value === 'object' && !Array.isArray(row.configuration_value)
    ? row.configuration_value as Record<string, any>
    : {};
  return {
    ...value,
    id: row.id,
    storeId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function savePosConfigDocument(
  db: DataSource,
  storeId: string,
  configurationName: string,
  value: Record<string, any>,
): Promise<Record<string, any>> {
  const payload = { ...value };
  delete payload.id;
  delete payload.storeId;
  delete payload.createdAt;
  delete payload.updatedAt;
  const rows: Array<{ id: string; created_at: Date; updated_at: Date }> = await db.query(
    `INSERT INTO public.store_pos_configurations (store_id, configuration_name, configuration_value)
     VALUES ($1::uuid, $2, $3::jsonb)
     ON CONFLICT (store_id, configuration_name) DO UPDATE
       SET configuration_value = EXCLUDED.configuration_value,
           updated_at = now()
     RETURNING id::text AS id, created_at, updated_at`,
    [storeId, configurationName, JSON.stringify(payload)],
  );
  const row = rows[0];
  return {
    ...payload,
    id: row.id,
    storeId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
