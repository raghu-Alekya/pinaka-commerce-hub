import 'reflect-metadata';
import './load-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { postgresConnectionOptions } from '../libs/database/src';
import { RELATIONSHIPS } from '../apps/merchant-service/src/relationships.config';
import { RELATIONSHIP_CONTROLLERS, RelationshipOwnerGuard } from '../apps/merchant-service/src/relationships.controller';
import { RelationshipsRepository } from '../apps/merchant-service/src/relationships.repository';

// Real PostgreSQL, all fixtures/writes rolled back. The test-only middleware simulates
// the user attached by the production session guard; the OWNER guard remains real.
const repository = new RelationshipsRepository();
Object.assign(repository, { onModuleInit: async () => {}, onModuleDestroy: async () => {} });
@Module({ controllers: RELATIONSHIP_CONTROLLERS, providers: [RelationshipOwnerGuard,
  { provide: RelationshipsRepository, useValue: repository }] })
class TestModule {}

async function main() {
  const db = new DataSource({ ...postgresConnectionOptions([]), synchronize: false });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => { req.user = { role: req.headers['x-test-role'] }; next(); });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  Object.assign(repository, { db: { transaction: async (work: any) => {
    await runner.query('SAVEPOINT api_request');
    try { const result = await work(runner.manager); await runner.query('RELEASE SAVEPOINT api_request'); return result; }
    catch (error) { await runner.query('ROLLBACK TO SAVEPOINT api_request'); await runner.query('RELEASE SAVEPOINT api_request'); throw error; }
  } } });
  let checks = 0;
  const expect = (actual: unknown, expected: unknown, note = '') => { assert.deepEqual(actual, expected, note); checks++; };
  try {
    const suffix = randomUUID();
    const ids = { merchantId: `M-TEST-${suffix}`, otherMerchant: `M-OTHER-${suffix}`, storeId: `S-TEST-${suffix}`, otherStore: `S-OTHER-${suffix}`,
      subscriptionId: `SUB-TEST-${suffix}`, otherSubscription: `SUB-OTHER-${suffix}`, storeTypeId: randomUUID() as string, planId: randomUUID() as string, featureId: randomUUID() as string, roleTemplateId: randomUUID() as string };
    // Match the non-RFC version/variant format used by existing PostgreSQL seeds.
    for (const key of ['storeTypeId', 'planId', 'featureId', 'roleTemplateId'] as const) {
      ids[key] = ids[key].slice(0, 9) + '0000-0000-0000-' + ids[key].slice(24);
    }
    for (const merchant of [ids.merchantId, ids.otherMerchant]) {
      await runner.query('INSERT INTO merchants (id,"businessName","ownerName",email,phone) VALUES ($1,\'API test\',\'Owner\',$2,\'123\')', [merchant,`${merchant}@example.invalid`]);
    }
    await runner.query("INSERT INTO store_types (id,store_type_code,name) VALUES ($1,$2,'API type')", [ids.storeTypeId,`T-${suffix}`]);
    await runner.query("INSERT INTO features (id,feature_key,name,category,feature_type) VALUES ($1,$2,'API feature','TEST','BOOLEAN')", [ids.featureId,`F-${suffix}`]);
    await runner.query("INSERT INTO role_templates (id,role_code,name,scope_type) VALUES ($1,$2,'API role','STORE')", [ids.roleTemplateId,`R-${suffix}`]);
    await runner.query("INSERT INTO plans (id,plan_code,name,billing_model,base_price,currency,billing_cycle) VALUES ($1,$2,'API plan','FLAT',10,'USD','MONTHLY')", [ids.planId,`P-${suffix}`]);
    for (const [store,merchant,subscription] of [[ids.storeId,ids.merchantId,ids.subscriptionId],[ids.otherStore,ids.otherMerchant,ids.otherSubscription]]) {
      await runner.query("INSERT INTO stores (id,merchant_id,name,store_code,store_type_id,address,\"activationPin\") VALUES ($1,$2,'API store',$1,'RETAIL','{}','123456')", [store,merchant]);
      await runner.query("INSERT INTO subscriptions (id,merchant_id,plan_id,\"planName\",entitlements) VALUES ($1,$2,$3,'API plan','[]')", [subscription,merchant,ids.planId]);
    }
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const config of RELATIONSHIPS) {
      const route = '/' + config.path.replace(/:(\w+)/g, (_,key)=>ids[key as keyof typeof ids]);
      const child = ids[config.childKey as keyof typeof ids];
      const request = async (method: string, tail = '', body?: unknown, role = 'OWNER', prefix = route) => {
        const response = await fetch(base + prefix + tail, { method, headers: { 'content-type':'application/json','x-test-role':role }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      };
      expect((await request('GET','',undefined,'STAFF')).status,403);
      expect((await request('GET', '', undefined, '')).status,403);
      expect((await request('GET')).data.count,0);
      expect((await request('POST','',{})).status,400);
      expect((await request('POST','',{ [config.childKey]: child, unexpected: true })).status,400);
      if (config.childUuid) expect((await request('POST','',{ [config.childKey]:'bad-uuid' })).status,400);
      const missingChild = config.childUuid ? randomUUID() : 'STORE-NOT-FOUND';
      expect((await request('POST','',{ [config.childKey]: missingChild })).status,404);
      const mutable = Object.keys(config.fields)[0];
      expect((await request('POST','',{ [config.childKey]: child, [mutable]:null })).status,400);
      expect((await request('POST','',{ [config.childKey]: child, [mutable]:123 })).status,400);
      const fields = Object.fromEntries(Object.entries(config.fields).map(([key,field])=>[key, field.kind === 'boolean' ? true : field.kind === 'integer' ? 3 : field.kind === 'object' ? { test: true } : field.kind === 'status' ? 'ACTIVE' : field.kind === 'date' ? (key.endsWith('Until') || key === 'deactivatedAt' ? '2026-10-02T00:00:00Z' : '2026-10-01T00:00:00Z') : 'test']));
      const created = await request('POST','',{ [config.childKey]: child, ...fields });
      expect(created.status,201,JSON.stringify(created.data));
      expect(created.data.item[config.childKey],child);
      expect(created.data.item[config.parentParam],ids[config.parentParam as keyof typeof ids]);
      expect((await request('POST','',{ [config.childKey]: child })).status,409);
      expect((await request('GET')).data.count,1);
      expect((await request('GET',`/${child}`)).data.item.id,created.data.item.id);
      expect((await request('PATCH',`/${child}`,{})).status,400);
      expect((await request('PATCH',`/${child}`,{ merchantId: ids.otherMerchant })).status,400);
      expect((await request('PATCH',`/${child}`,{ [config.childKey]: child })).status,400);
      const patch = { [mutable]: mutable === 'status' ? 'INACTIVE' : false };
      const patched = await request('PATCH',`/${child}`,patch);
      expect(patched.status,200,JSON.stringify(patched.data));
      expect(patched.data.item[mutable],patch[mutable]);
      expect(patched.data.item.createdAt,created.data.item.createdAt);
      if ('effectiveFrom' in config.fields) {
        expect((await request('PATCH',`/${child}`,{effectiveUntil:'2026-09-01T00:00:00Z'})).status,400);
        expect((await request('PATCH',`/${child}`,{effectiveFrom:'not-a-date'})).status,400);
        expect((await request('PATCH',`/${child}`,{effectiveUntil:null})).status,200);
      }
      if ('activatedAt' in config.fields) expect((await request('PATCH',`/${child}`,{deactivatedAt:'2026-09-01T00:00:00Z'})).status,400);
      if ('configurationJson' in config.fields) expect((await request('PATCH',`/${child}`,{configurationJson:[]})).status,400);
      if (config.ownerColumn) {
        const wrongScope = route.replace(ids.merchantId,ids.otherMerchant);
        for (const method of ['GET','POST','PATCH','PUT','DELETE']) {
          const tail = method === 'POST' || method === 'GET' ? '' : `/${child}`;
          expect((await request(method,tail,method === 'POST' ? {[config.childKey]:child} : ['PATCH','PUT'].includes(method)?patch:undefined,'OWNER',wrongScope)).status,404);
        }
      }
      if (config.tenantColumn) expect((await request('POST','',{storeId:ids.otherStore})).status,404);
      const replaced = await request('PUT',`/${child}`,{});
      expect(replaced.status,200);
      for (const [key,field] of Object.entries(config.fields)) expect(replaced.data.item[key],field.default);
      expect((await request('DELETE',`/${child}`)).status,200);
      expect((await request('DELETE',`/${child}`)).status,404);
      expect((await request('GET',`/${child}`)).status,404);
      expect((await request('GET')).data.count,0);
      console.log(`PASS ${config.name}: CRUD, validation, uniqueness, scope, authorization`);
    }
    console.log(`PASS ${checks} assertions; all fixtures rolled back`);
  } finally {
    await app.close();
    await runner.rollbackTransaction();
    await runner.release();
    await db.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
