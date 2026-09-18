import './load-env';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { Client } = require('pg');
import { DataSource } from 'typeorm';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { postgresConnectionOptions } from '../libs/database/src';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { OnboardingController } from '../apps/merchant-service/src/onboarding.controller';
import { AppController } from '../apps/merchant-service/src/app.controller';
import { MerchantEntity } from '../apps/merchant-service/src/entities/merchant.entity';
import { StoreEntity } from '../apps/merchant-service/src/entities/store.entity';
import { StoreTypeEntity } from '../apps/merchant-service/src/entities/store-type.entity';
import { SubscriptionEntity } from '../apps/merchant-service/src/entities/subscription.entity';
import { PlanEntity } from '../apps/merchant-service/src/entities/plan.entity';
import { OnboardingAuditEntity } from '../apps/merchant-service/src/entities/onboarding-audit.entity';
import { ensureOnboardingSchema } from '../apps/merchant-service/src/onboarding.schema';

const repository = new MerchantRepository();
Object.assign(repository, { onModuleInit: async () => {}, getWebsiteConnection: async () => null });
@Module({ controllers: [OnboardingController, AppController], providers: [{ provide: MerchantRepository, useValue: repository }] })
class TestModule {}

async function main() {
  const options: any = postgresConnectionOptions([]);
  const admin = new Client(options.url ? { connectionString: options.url } : {
    host: options.host, port: options.port, user: options.username, password: options.password, database: options.database,
  });
  const database = `pch_onboarding_test_${randomUUID().replace(/-/g, '')}`;
  let db: DataSource | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    const target = options.url ? { ...options, url: (() => { const url = new URL(options.url); url.pathname = '/' + database; return url.toString(); })() } : { ...options, database };
    db = new DataSource({ ...target, synchronize: true, entities: [MerchantEntity, StoreEntity, StoreTypeEntity, SubscriptionEntity, PlanEntity, OnboardingAuditEntity] });
    await db.initialize();
    await ensureOnboardingSchema(db); await ensureOnboardingSchema(db);
    await db.query('CREATE TABLE features (id uuid PRIMARY KEY, feature_key text); CREATE TABLE plan_entitlements (plan_id uuid, feature_id uuid, enabled boolean, limit_value text)');
    const plan = await db.getRepository(PlanEntity).save({ planCode: 'STARTER', name: 'Starter', basePrice: 29, currency: 'USD' });
    await db.getRepository(StoreTypeEntity).save({ storeTypeCode: 'GROCERY', name: 'Grocery' });
    Object.assign(repository, { dataSource: db, merchantRepo: db.getRepository(MerchantEntity), storeRepo: db.getRepository(StoreEntity),
      subRepo: db.getRepository(SubscriptionEntity), planMasterRepo: db.getRepository(PlanEntity), storeTypeRepo: db.getRepository(StoreTypeEntity), auditRepo: db.getRepository(OnboardingAuditEntity) });
    app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const payload = { merchant: { code: 'MER-TEST', business: 'Legal Business', display: 'Display Name', name: 'SingleName', email: 'owner@example.test', phone: '+15555550123', country: 'United States', city: 'Phoenix', state: 'Arizona', address: 'Test street', postal: '85001' },
      subscription: { planCode: 'STARTER', billingCycle: 'MONTHLY', startDate: '2026-01-31', licensedStoreCount: 1, licensedDeviceCount: 2 } };
    let response = await request('POST', '/merchants/onboarding', payload);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.stores.length, 0); assert.equal(response.body.subscription.status, 'PENDING');
    assert.equal(response.body.subscription.renewalDate, '2026-02-28'); assert.equal(response.body.subscription.planId, plan.id);
    assert.equal((await request('POST', '/merchants/onboarding', payload)).status, 409);
    assert.equal((await request('PUT', '/merchants/other/onboarding', payload)).status, 400);
    const hours = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => ({ day, status: 'Open', open: '22:00', close: '06:00', shifts: 2 }));
    const store = { merchantId: 'MER-TEST', storeId: 'STR-TEST', name: 'Store', type: 'GROCERY', address: 'Other street', city: 'Toronto', state: 'Ontario', zip: 'M5V 2T6', country: 'Canada', hours, licensed: true, devices: [{ name: 'Till', type: 'POS', serial: 'SERIAL-1' }], features: ['Refunds'], roles: [{ name: 'Cashier', scope: 'Store', permissions: { Refunds: ['View'] } }] };
    response = await request('PUT', '/merchants/MER-TEST/onboarding', { merchant: payload.merchant, stores: [store] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.stores[0].onboardingSetup.hours.length, 7);
    assert.equal(response.body.stores[0].address.country, 'Canada');
    assert.equal(response.body.stores[0].status, 'PENDING');
    const detail = await request('GET', '/merchants/MER-TEST/onboarding');
    assert.equal(detail.body.stores[0].devices[0].serial, 'SERIAL-1');
    assert.equal(detail.body.merchant.business, 'Legal Business');
    const failure = { ...payload, merchant: { ...payload.merchant, display: 'Must roll back' }, stores: [store, { ...store, storeId: 'STR-OVER-LIMIT', devices: [] }] };
    assert.equal((await request('PUT', '/merchants/MER-TEST/onboarding', failure)).status, 400);
    assert.equal((await request('GET', '/merchants/MER-TEST/onboarding')).body.merchant.display, 'Display Name');
    assert.equal(await db.getRepository(StoreEntity).count(), 1);
    assert.equal((await request('POST', '/merchants/onboarding', { ...payload, merchant: { ...payload.merchant, code: 'MER-FAIL', email: 'other@example.test' }, subscription: { ...payload.subscription, planCode: 'UNKNOWN' } })).status, 400);
    assert.equal(await db.getRepository(MerchantEntity).count(), 1);
    assert.equal((await request('PUT', '/merchants/MER-TEST/onboarding', { merchant: payload.merchant, stores: [{ ...store, hours: [hours[0]] }] })).status, 400);
    assert.equal((await request('POST', '/merchants/onboarding', { ...payload, price: 0 })).status, 400);
    const other = { ...payload, merchant: { ...payload.merchant, code: 'MER-OTHER', email: 'other@example.test' } };
    assert.equal((await request('POST', '/merchants/onboarding', other)).status, 201);
    assert.equal((await request('PUT', '/merchants/MER-OTHER/onboarding', { merchant: other.merchant, stores: [{ ...store, merchantId: 'MER-OTHER' }] })).status, 409);
    assert.equal((await db.getRepository(StoreEntity).findOneByOrFail({ id: store.storeId })).merchantId, 'MER-TEST');
    assert.equal((await request('PUT', '/merchants/MISSING/onboarding', { merchant: { ...payload.merchant, code: 'MISSING' } })).status, 404);
    // Existing store APIs retain and round-trip new setup fields, including explicit clearing.
    response = await request('PUT', '/stores/STR-TEST', { ...store, features: [], devices: [], roles: [] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.store.onboardingSetup.features, []);
    const { hours: _hours, devices: _devices, features: _features, roles: _roles, ...location } = store;
    response = await request('PUT', '/stores/STR-TEST', { ...location, name: 'Renamed' });
    assert.equal(response.status, 200); assert.equal(response.body.store.onboardingSetup.hours.length, 7);
    console.log('PASS: onboarding HTTP validation, two-stage persistence, updates, setup round-trip, month-end renewal, duplicate protection, capacity enforcement and transaction rollback.');
  } finally {
    if (app) await app.close(); if (db?.isInitialized) await db.destroy();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
