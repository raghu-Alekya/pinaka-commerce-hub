import { DataSource, Table, TableIndex, TableUnique } from 'typeorm';

/**
 * Optional vendor-to-store assignments. A vendor can belong to a merchant
 * without any store rows; passing storeId then returns only explicit assignments.
 */
export async function ensureVendorStoreSchema(db: DataSource): Promise<void> {
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    if (await runner.hasTable('vendor_stores')) return;
    await runner.createTable(new Table({
      name: 'vendor_stores',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, isNullable: false, default: 'gen_random_uuid()' },
        { name: 'merchant_id', type: 'uuid', isNullable: false },
        { name: 'vendor_id', type: 'uuid', isNullable: false },
        { name: 'store_id', type: 'uuid', isNullable: false },
        { name: 'status', type: 'varchar', length: '20', isNullable: false, default: `'ACTIVE'` },
        { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
      ],
      uniques: [
        new TableUnique({ name: 'vendor_stores_vendor_store_uq', columnNames: ['vendor_id', 'store_id'] }),
      ],
      indices: [
        new TableIndex({ name: 'vendor_stores_merchant_idx', columnNames: ['merchant_id'] }),
        new TableIndex({ name: 'vendor_stores_store_idx', columnNames: ['store_id'] }),
      ],
    }));
  } finally {
    await runner.release();
  }
}
