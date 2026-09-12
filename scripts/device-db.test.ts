import './load-env';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DeviceEntity } from '../apps/merchant-service/src/entities/device.entity';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';

async function main() {
  const db = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL || undefined,
    host: process.env.POSTGRES_HOST || 'localhost', port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER || 'pdh_user', password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: process.env.POSTGRES_DB || 'pinaka_commerce_hub', entities: [DeviceEntity], synchronize: false });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  try {
    const [store] = await runner.query('SELECT id, "merchantId" FROM stores LIMIT 1');
    assert.ok(store, 'A store is required for the database round-trip test');
    const repository = new MerchantRepository();
    Object.assign(repository, { deviceRepo: runner.manager.getRepository(DeviceEntity) });
    const id = randomUUID();
    await repository.createDevice({ id, storeId: store.id, merchantId: store.merchantId,
      serialNumber: `TEST-${id}`, details: { deviceName: 'Rollback test', status: 'Active', image: 'excluded' }, createdAt: new Date() });
    const device = (await repository.listDevices()).find(item => item.id === id);
    assert.equal(device?.details.deviceName, 'Rollback test');
    assert.equal(device?.details.image, undefined);
    await assert.rejects(() => repository.createDevice({ id: randomUUID(), storeId: store.id,
      merchantId: store.merchantId, serialNumber: `TEST-${id}`, details: {}, createdAt: new Date() }),
      (error: any) => error.getStatus() === 409);
    console.log('PASS: PostgreSQL device persistence, listing, image exclusion and unique serial constraint (rolled back)');
  } finally { await runner.rollbackTransaction(); await runner.release(); await db.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
