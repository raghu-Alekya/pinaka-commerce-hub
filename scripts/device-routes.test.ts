import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { Module, ValidationPipe } from '@nestjs/common';
import { DeviceController } from '../apps/merchant-service/src/device.controller';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';

const repository = new MerchantRepository();
let saved: any[] = [];
Object.assign(repository, {
  onModuleInit: async () => {},
  getMerchantById: async (id: string) => ({ merchant: id === 'merchant' ? { id } : null }),
  getStoreById: async (id: string) => id === 'missing' ? null : { id, merchantId: id === 'other' ? 'other' : 'merchant' },
  getAllMerchants: async () => [{ id: 'merchant', businessName: 'Real merchant' }],
  listStores: async () => [{ id: 'store', storeName: 'Real store' }],
  deviceRepo: {
    save: async (device: any) => {
      if (saved.some(item => item.serialNumber === device.serialNumber)) throw { code: '23505' };
      saved.push(device); return device;
    },
    query: async () => saved,
  },
});
@Module({ controllers: [DeviceController], providers: [{ provide: MerchantRepository, useValue: repository }] })
class TestModule {}

async function main() {
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
  try {
    const url = (await app.getUrl()) + '/api/v1/devices';
    const body = { deviceName: ' POS 1 ', deviceType: 'POS Terminal', serialNumber: ' sn-1 ', merchantId: 'merchant', storeId: 'store' };
    const post = (data: any) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.deepEqual(await (await fetch(url)).json(), { count: 0, devices: [] });
    for (const change of [{ deviceName: ' ' }, { deviceType: 'bad' }, { serialNumber: '' }, { enableImmediately: 'false' }, { timeZone: 'bad' }, { macAddress: 'bad' }, { image: 'data:image/png;base64,YmFk' }, { notes: 'x'.repeat(501) }]) {
      assert.equal((await post({ ...body, ...change })).status, 400, JSON.stringify(change));
    }
    assert.equal((await post({ ...body, merchantId: 'missing' })).status, 404);
    assert.equal((await post({ ...body, storeId: 'missing' })).status, 404);
    assert.equal((await post({ ...body, storeId: 'other' })).status, 400);
    const created = await post(body);
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    const result = createdBody.device;
    assert.equal(result.deviceName, 'POS 1');
    assert.equal(result.serialNumber, 'SN-1');
    assert.equal((await post({ ...body, serialNumber: 'SN-1' })).status, 409);
    assert.equal((await post({ ...body, serialNumber: 'sn-2', enableImmediately: false })).status, 201);
    const listing = await (await fetch(url)).json();
    assert.equal(listing.count, 2);
    assert.equal(listing.devices[0].merchantName, 'Real merchant');
    assert.equal(listing.devices[0].storeName, 'Real store');
    assert.equal(listing.devices[0].connectionStatus, 'Offline');
    assert.equal(listing.devices[1].connectionStatus, 'Inactive');
    Object.assign(repository, { isDbConnected: false });
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await post({ ...body, serialNumber: 'sn-3' })).status, 503);
    console.log('PASS: device creation/listing, validation, assignment, duplicates, status and unavailable storage');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
