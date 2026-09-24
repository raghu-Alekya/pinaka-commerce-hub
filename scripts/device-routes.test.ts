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
  getDevice: async (id: string) => saved.find(item => item.id === id) || null,
  updateDevice: async (id: string, fields: any) => {
    const device = saved.find(item => item.id === id);
    if (!device) return null;
    Object.assign(device, fields);
    return device;
  },
  deleteDevice: async (id: string) => {
    const index = saved.findIndex(item => item.id === id);
    if (index < 0) return false;
    saved.splice(index, 1);
    return true;
  },
  deviceRepo: {
    create: (device: any) => device,
    save: async (device: any) => {
      if (saved.some(item => item.serialNumber === device.serialNumber)) throw { code: '23505' };
      saved.push(device); return device;
    },
    find: async () => saved,
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
    const paginated = await (await fetch(`${url}?page=1&limit=1`)).json();
    assert.equal(paginated.devices.length, 1);
    assert.deepEqual(paginated.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    assert.equal(listing.devices[0].merchantName, 'Real merchant');
    assert.equal(listing.devices[0].storeName, 'Real store');
    assert.equal(listing.devices[0].connectionStatus, 'Offline');
    assert.equal(listing.devices[1].connectionStatus, 'Inactive');
    const deviceUrl = `${url}/${result.id}`;
    assert.equal((await (await fetch(deviceUrl)).json()).device.id, result.id);
    const put = await fetch(deviceUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: 'Renamed POS' }) });
    assert.equal(put.status, 200);
    const updated = (await put.json()).device;
    assert.equal(updated.deviceName, 'Renamed POS');
    assert.equal(updated.serialNumber, 'SN-1');
    const patchUpdate = await fetch(deviceUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Updated note' }) });
    assert.equal(patchUpdate.status, 200);
    assert.equal((await patchUpdate.json()).device.notes, 'Updated note');
    assert.equal((await fetch(deviceUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: ' ' }) })).status, 400);
    assert.equal((await fetch(`${url}/00000000-0000-4000-8000-000000000000`)).status, 404);
    assert.equal((await fetch(deviceUrl, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(deviceUrl, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(deviceUrl)).status, 404);
    const noStore = await post({ ...body, serialNumber: 'sn-no-store', storeId: undefined });
    assert.equal(noStore.status, 201);
    const noStoreDevice = (await noStore.json()).device;
    assert.equal(noStoreDevice.storeId, null);
    const noStoreUpdate = await fetch(`${url}/${noStoreDevice.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: 'No store POS' }) });
    assert.equal(noStoreUpdate.status, 200);
    assert.equal((await noStoreUpdate.json()).device.storeId, null);
    const listAfterNoStoreCreate = await (await fetch(url)).json();
    const listedNoStoreDevice = listAfterNoStoreCreate.devices.find((item: any) => item.id === noStoreDevice.id);
    assert.ok(listedNoStoreDevice);
    assert.equal(listedNoStoreDevice.storeId, null);
    Object.assign(repository, { deviceRepo: undefined });
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await post({ ...body, serialNumber: 'sn-3' })).status, 503);
    console.log('PASS: Device CRUD, pagination, validation, assignment, duplicate serial, update preservation and unavailable storage');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
