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
  getAllMerchants: async () => [{ id: 'merchant', businessName: 'Real merchant' }],
  listDevicesByMerchantId: async (merchantId: string) => saved.filter(item => item.merchantId === merchantId),
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
    const body = { deviceName: ' POS 1 ', deviceType: 'POS Terminal', serialNumber: ' sn-1 ', merchantId: 'merchant' };
    const post = (data: any) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.deepEqual(await (await fetch(url)).json(), { count: 0, devices: [] });
    for (const change of [{ deviceName: ' ' }, { deviceType: 'bad' }, { serialNumber: '' }, { enableImmediately: 'false' }, { timeZone: 'bad' }, { macAddress: 'bad' }, { image: 'data:image/png;base64,YmFk' }, { notes: 'x'.repeat(501) }]) {
      assert.equal((await post({ ...body, ...change })).status, 400, JSON.stringify(change));
    }
    assert.equal((await post({ ...body, merchantId: 'missing' })).status, 404);
    const created = await post(body);
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    const result = createdBody.device;
    assert.equal(result.deviceName, 'POS 1');
    assert.equal(result.serialNumber, 'SN-1');
    assert.equal((await post({ ...body, serialNumber: 'SN-1' })).status, 409);
    assert.equal((await post({ ...body, serialNumber: 'sn-2', status: 'Inactive' })).status, 201);
    const listing = await (await fetch(url)).json();
    assert.equal(listing.count, 2);
    const paginated = await (await fetch(`${url}?page=1&limit=1`)).json();
    assert.equal(paginated.devices.length, 1);
    assert.deepEqual(paginated.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    assert.equal(listing.devices[0].merchantName, 'Real merchant');
    assert.equal(listing.devices[0].connectionStatus, 'Offline');
    assert.equal(listing.devices[1].connectionStatus, 'Inactive');
    const merchantListing = await (await fetch(`${url}/merchant/merchant`)).json();
    assert.equal(merchantListing.count, 2);
    assert.ok(merchantListing.devices.every((device: any) => device.merchantId === 'merchant'));
    assert.equal((await fetch(`${url}/merchant/missing`)).status, 404);
    const deviceUrl = `${url}/${result.id}`;
    assert.equal((await (await fetch(deviceUrl)).json()).device.id, result.id);
    const put = await fetch(deviceUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: 'Renamed POS' }) });
    assert.equal(put.status, 200);
    const updated = (await put.json()).device;
    assert.equal(updated.deviceName, 'Renamed POS');
    assert.equal(updated.serialNumber, 'SN-1');
    const patchUpdate = await fetch(deviceUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Inactive' }) });
    assert.equal(patchUpdate.status, 200);
    assert.equal((await patchUpdate.json()).device.status, 'Inactive');
    assert.equal((await fetch(deviceUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: ' ' }) })).status, 400);
    assert.equal((await fetch(`${url}/00000000-0000-4000-8000-000000000000`)).status, 404);
    assert.equal((await fetch(deviceUrl, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(deviceUrl, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(deviceUrl)).status, 404);
    const secondMerchantDevice = await post({ ...body, serialNumber: 'sn-3' });
    assert.equal(secondMerchantDevice.status, 201);
    assert.equal((await (await fetch(`${url}/merchant/merchant`)).json()).count, 2);
    Object.assign(repository, { deviceRepo: undefined });
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await post({ ...body, serialNumber: 'sn-4' })).status, 503);
    console.log('PASS: Device CRUD, pagination, validation, merchant filtering, duplicate serial and update preservation');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
