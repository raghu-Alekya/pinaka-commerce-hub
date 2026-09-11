import './load-env';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { StoreTypeController, FeatureController, RoleTemplateController, PlanController } from '../apps/merchant-service/src/master-data.controller';

const repository = new MerchantRepository();
Object.assign(repository, { onModuleInit: async () => {} });
@Module({ controllers: [StoreTypeController, FeatureController, RoleTemplateController, PlanController], providers: [{ provide: MerchantRepository, useValue: repository }] })
class TestModule {}
async function main() {
  const db = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL || undefined,
    host: process.env.POSTGRES_HOST || 'localhost', port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER || 'pdh_user', password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: process.env.POSTGRES_DB || 'pinaka_commerce_hub', synchronize: false });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  // Each request gets a savepoint so expected SQL constraint failures do not abort the test transaction.
  Object.assign(repository, { dataSource: { isInitialized: true, query: async (sql: string, values: unknown[]) => {
    await runner.query('SAVEPOINT request');
    try { const result = await runner.query(sql, values); await runner.query('RELEASE SAVEPOINT request'); return result; }
    catch (error) { await runner.query('ROLLBACK TO SAVEPOINT request'); throw error; }
  } } });
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    for (const [path, key, item, collection] of [['store-types', 'storeTypeCode', 'storeType', 'storeTypes'], ['features', 'featureKey', 'feature', 'features'], ['role-templates', 'roleCode', 'roleTemplate', 'roleTemplates'], ['plans', 'planCode', 'plan', 'plans']]) {
      const url = `${base}/api/v1/${path}`;
      const request = (method: string, suffix = '', body?: object) => fetch(url + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
      const body = { [key]: `test-${randomUUID()}`, name: ' Test master ', ...(path === 'plans' ? { billingModel: 'FLAT', basePrice: 49.99, currency: 'INR', billingCycle: 'MONTHLY' } : {}), ...(path === 'features' ? { category: 'POS', featureType: 'BOOLEAN' } : {}) };
      for (const invalid of [{ name: ' ' }, { status: null }, { status: 'bad' }, { unexpected: true }, { [key]: 'x'.repeat(101) }]) assert.equal((await request('POST', '', { ...body, ...invalid })).status, 400);
      if (path === 'features') assert.equal((await request('POST', '', { ...body, featureType: 'bad' })).status, 400);
      if (path === 'role-templates') {
        assert.equal((await request('POST', '', { ...body, scopeType: 'INVALID' })).status, 400);
      }
      if (path === 'plans') {
        for (const invalid of [{ basePrice: -1 }, { basePrice: 1.123 }, { basePrice: '10' }, { billingModel: 'INVALID' }, { billingCycle: 'WEEKLY' }, { currency: 'INVALID' }]) {
          assert.equal((await request('POST', '', { ...body, ...invalid })).status, 400);
        }
      }
      const response = await request('POST', '', body);
      const payload = await response.json();
      assert.equal(response.status, 201, JSON.stringify(payload));
      const created = payload[item];
      assert.equal(created.name, 'Test master');
      assert.equal(created.status, 'ACTIVE');
      for (const method of (path === 'features' || path === 'store-types' ? ['PUT', 'PATCH'] : [])) {
        for (const invalid of [{}, { status: null }, { status: 'INVALID' }, { status: 'ACTIVE', name: 'Extra' }]) {
          assert.equal((await request(method, `/${created.id}/status`, invalid)).status, 400);
        }
        const statusResponse = await request(method, `/${created.id}/status`, { status: 'INACTIVE' });
        assert.equal(statusResponse.status, 200);
        const updated = (await statusResponse.json())[item];
        assert.equal(updated.status, 'INACTIVE');
        assert.equal(updated.name, created.name);
        assert.equal(updated[key], created[key]);
        assert.equal((await request(method, `/${randomUUID()}/status`, { status: 'ACTIVE' })).status, 404);
      }
      assert.equal((await request('POST', '', body)).status, 409);
      assert.equal((await (await request('GET', `/${created.id}`)).json())[item].id, created.id);
      assert.ok((await (await request('GET')).json())[collection].some((row: any) => row.id === created.id));
      assert.equal((await request('PATCH', `/${created.id}`, {})).status, 400);
      assert.equal((await request('PATCH', `/${created.id}`, { name: null })).status, 400);
      assert.equal((await request('PUT', `/${created.id}`, { name: 'Incomplete' })).status, 400);
      const patched = await (await request('PATCH', `/${created.id}`, { status: 'INACTIVE' })).json();
      assert.equal(patched[item].status, 'INACTIVE');
      assert.equal(patched[item].createdAt, created.createdAt);
      const replaced = await (await request('PUT', `/${created.id}`, { ...body, name: 'Replaced' })).json();
      assert.equal(replaced[item].status, 'ACTIVE');
      assert.equal(replaced[item].name, 'Replaced');
      assert.equal((await request('GET', '/invalid')).status, 400);
      assert.equal((await request('DELETE', `/${created.id}`)).status, 200);
      for (const method of ['GET', 'DELETE', 'PATCH', 'PUT']) assert.equal((await request(method, `/${created.id}`, method === 'PATCH' || method === 'PUT' ? body : undefined)).status, 404);
    }
    Object.assign(repository, { isDbConnected: false });
    assert.equal((await fetch(`${base}/api/v1/features`)).status, 503);
    console.log('PASS: all four master CRUD APIs, PostgreSQL persistence, validation, duplicates, missing records, and unavailable storage (rolled back)');
  } finally { await app.close(); await runner.rollbackTransaction(); await runner.release(); await db.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });


