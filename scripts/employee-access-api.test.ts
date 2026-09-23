import 'reflect-metadata';
import './load-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { Client } = require('pg');
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntitySchema } from 'typeorm';
import { connectPostgres, postgresConnectionOptions } from '../libs/database/src';
import { StoreEntity } from '../apps/merchant-service/src/entities/store.entity';
import { ensureEmployeeAccessSchema } from '../apps/merchant-service/src/employee-access.schema';
import { EmployeeAccessRepository } from '../apps/merchant-service/src/employee-access.repository';
import { EmployeeAccessController } from '../apps/merchant-service/src/employee-access.controller';
import { RelationshipsRepository } from '../apps/merchant-service/src/relationships.repository';
import { RELATIONSHIP_CONTROLLERS, RelationshipOwnerGuard } from '../apps/merchant-service/src/relationships.controller';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { EmployeeController } from '../apps/merchant-service/src/employee.controller';
import { RoleController } from '../apps/merchant-service/src/role.controller';
import { PermissionController } from '../apps/merchant-service/src/permission.controller';
import { EmployeeEntity } from '../apps/merchant-service/src/entities/employee.entity';
import { RoleEntity } from '../apps/merchant-service/src/entities/role.entity';
import { PermissionEntity } from '../apps/merchant-service/src/entities/permission.entity';
import { RoleTemplateEntity } from '../apps/merchant-service/src/entities/role-template.entity';
import { MerchantEntity } from '../apps/merchant-service/src/entities/merchant.entity';

// Use a fresh, uniquely named database; never drop or clear the application database.
const database = `pch_employee_access_test_${process.pid}_${randomUUID().replace(/-/g, '')}`;
const relationships = new RelationshipsRepository();
const access = new EmployeeAccessRepository();
const merchants = new MerchantRepository();
for (const repository of [relationships, access, merchants]) {
  Object.assign(repository, { onModuleInit: async () => {}, onModuleDestroy: async () => {} });
}
@Module({ controllers: [...RELATIONSHIP_CONTROLLERS, EmployeeController, RoleController, PermissionController, EmployeeAccessController],
  providers: [RelationshipOwnerGuard, { provide: RelationshipsRepository, useValue: relationships },
    { provide: EmployeeAccessRepository, useValue: access }, { provide: MerchantRepository, useValue: merchants }] })
class TestModule {}

async function main() {
  const options: any = postgresConnectionOptions([]);
  const admin = new Client(options.url ? { connectionString: options.url } : {
    host: options.host, port: options.port, user: options.username, password: options.password, database: options.database,
  });
  await admin.connect();
  let db: DataSource | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let createdDatabase = false;
  let checks = 0;
  const expect = (actual: unknown, expected: unknown, note?: string) => { assert.deepEqual(actual, expected, note); checks++; };
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    createdDatabase = true;
    const testOptions = options.url ? { ...options, url: (() => { const url = new URL(options.url); url.pathname = '/' + database; return url.toString(); })() } : { ...options, database };
    db = new DataSource({ ...testOptions, synchronize: false,
      entities: [EmployeeEntity, RoleEntity, PermissionEntity, RoleTemplateEntity, MerchantEntity] });
    await db.initialize();
    await db.query(`
      CREATE TABLE merchants (id varchar(100) PRIMARY KEY);
      CREATE TABLE stores (id varchar(100) PRIMARY KEY, "merchantId" varchar(100) NOT NULL REFERENCES merchants(id), store_type_id text, status text);
      CREATE TABLE features (id uuid PRIMARY KEY, feature_key text, status text);
      CREATE TABLE store_types (id uuid PRIMARY KEY, store_type_code text, status text);
      CREATE TABLE plans (id uuid PRIMARY KEY, status text);
      CREATE TABLE subscriptions (id varchar(100) PRIMARY KEY, merchant_id varchar(100), plan_id uuid, status text);
      CREATE TABLE subscription_stores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id varchar(100),subscription_id varchar(100),store_id varchar(100),status text,activated_at timestamptz,deactivated_at timestamptz);
      CREATE TABLE store_type_features (store_type_id uuid,feature_id uuid);
      CREATE TABLE plan_entitlements (plan_id uuid,feature_id uuid,enabled boolean);
      CREATE TABLE subscription_entitlements (subscription_id varchar(100),feature_id uuid,enabled boolean,effective_from timestamptz,effective_until timestamptz);
      CREATE TABLE store_entitlements (store_id varchar(100),feature_id uuid,enabled boolean,effective_from timestamptz,effective_until timestamptz);
      CREATE TABLE role_template_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "roleTemplateId" uuid, "permissionId" uuid,
        "defaultAllowed" boolean NOT NULL DEFAULT false, "createdAt" timestamptz, "updatedAt" timestamptz
      );
      CREATE TABLE role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "roleId" uuid, "permissionId" uuid,
        allowed boolean NOT NULL DEFAULT false, "createdAt" timestamptz, "updatedAt" timestamptz
      );
    `);
    await ensureEmployeeAccessSchema(db);
    await ensureEmployeeAccessSchema(db);
    // Regression: global synchronize=true must not remove repository-owned indexes
    // or let an unrelated service rename merchant columns before merchant startup.
    const envKeys = ['POSTGRES_DB', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'TYPEORM_SYNCHRONIZE'];
    const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    const columnsBefore = await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name");
    let merchantConnection: DataSource | undefined;
    let otherConnection: DataSource | undefined;
    try {
      if (testOptions.url) {
        for (const key of envKeys) delete process.env[key];
        process.env.DATABASE_URL = testOptions.url;
      } else process.env.POSTGRES_DB = database;
      process.env.TYPEORM_SYNCHRONIZE = 'true';
      merchantConnection = await connectPostgres('Merchant startup regression', [StoreEntity], { synchronize: false });
      otherConnection = await connectPostgres('Unrelated service regression', [new EntitySchema({
        name: 'StartupSchemaProbe', tableName: 'startup_schema_probe', columns: { id: { type: String, primary: true } },
      })]);
      expect((await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='pch_stores_tenant_id'")).length, 1);
      expect(await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'startup_schema_probe' ORDER BY table_name,column_name"), columnsBefore);
    } finally {
      if (merchantConnection?.isInitialized) await merchantConnection.destroy();
      if (otherConnection?.isInitialized) await otherConnection.destroy();
      for (const key of envKeys) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
    }
    expect((await db.query("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('employees','roles','permissions','role_templates','employee_stores','employee_store_roles','role_permissions','role_template_permissions')"))[0].count, 8);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='role_permissions' AND column_name='permission_id'")).length, 1, 'legacy camelCase permissionId is renamed');
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='role_template_permissions' AND column_name='permission_id'")).length, 1);
    Object.assign(relationships, { db }); Object.assign(access, { db });
    Object.assign(merchants, { dataSource: db, employeeRepo: db.getRepository(EmployeeEntity), roleRepo: db.getRepository(RoleEntity),
      permissionRepo: db.getRepository(PermissionEntity), roleTemplateRepo: db.getRepository(RoleTemplateEntity), merchantRepo: db.getRepository(MerchantEntity) });
    const feature = randomUUID(), storeType = randomUUID(), plan = randomUUID(), template = randomUUID();
    await db.query("INSERT INTO merchants VALUES ('M1'),('M2')");
    await db.query("INSERT INTO features VALUES ($1,'POS','ACTIVE')", [feature]);
    await db.query("INSERT INTO store_types VALUES ($1,'RETAIL','ACTIVE')", [storeType]);
    await db.query("INSERT INTO stores VALUES ('S1','M1',$1,'ACTIVE'),('S2','M1',$1,'ACTIVE'),('OTHER','M2',$1,'ACTIVE')", [storeType]);
    await db.query("INSERT INTO plans VALUES ($1,'ACTIVE')", [plan]);
    await db.query("INSERT INTO subscriptions VALUES ('SUB1','M1',$1,'ACTIVE')", [plan]);
    await db.query("INSERT INTO subscription_stores(merchant_id,subscription_id,store_id,status) VALUES ('M1','SUB1','S1','ACTIVE')");
    await db.query('INSERT INTO store_type_features VALUES ($1,$2)', [storeType, feature]);
    await db.query('INSERT INTO plan_entitlements VALUES ($1,$2,true)', [plan, feature]);
    await db.query("INSERT INTO role_templates(id,role_code,name) VALUES ($1,'CASHIER','Cashier')", [template]);
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: any, _res: any, next: () => void) => { req.user = { role: req.headers['x-test-role'] }; next(); });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (method: string, path: string, body?: unknown, role = 'OWNER') => {
      const response = await fetch(base + '/api/v1' + path, { method, headers: { 'content-type': 'application/json', 'x-test-role': role }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const create = async (path: string, body: unknown, key: string) => {
      const result = await request('POST', path, body); expect(result.status, 201, JSON.stringify(result.data)); return result.data[key];
    };
    expect((await request('POST', '/permissions', {})).status, 400);
    expect((await request('POST', '/permissions', { featureId: randomUUID(), permissionKey: 'MISSING', name: 'Missing' })).status, 400);
    const permission = await create('/permissions', { featureId: feature, permissionKey: 'POS_SALE_CREATE', name: 'Create sale' }, 'permission');
    const employee = await create('/merchants/employees', { merchantId: 'M1', employeeCode: 'EMP-1', firstName: 'Sarah' }, 'employee');
    expect((await request('POST', '/merchants/employees', { merchantId: 'M1', employeeCode: '  ', firstName: 'Sarah' })).status, 400);
    expect((await request('PATCH', `/merchants/employees/${employee.id}`, { firstName: null })).status, 400);
    expect((await request('PATCH', `/merchants/employees/${employee.id}`, { firstName: '  ' })).status, 400);
    expect((await request('POST', '/merchants/employees', { merchantId: 'M1', employeeCode: 'X' })).status, 400);
    expect((await request('POST', '/merchants/employees', { merchantId: 'M2', employeeCode: 'EMP-1', firstName: 'Duplicate' })).status, 409);
    await create(`/role-templates/${template}/permissions`, { permissionId: permission.id, defaultAllowed: true }, 'item');
    const role = await create('/merchants/M1/roles', { roleCode: 'CASHIER', name: 'Cashier', sourceRoleTemplateId: template }, 'role');
    expect((await request('GET', `/merchants/M1/roles/${role.id}/permissions`)).data.items[0].allowed, true, 'template grants copied');
    const otherRole = await create('/merchants/M2/roles', { roleCode: 'CASHIER', name: 'Other cashier' }, 'role');
    const storesPath = `/merchants/employees/${employee.id}/stores`;
    const assignment = await create(storesPath, { storeId: 'S1', isPrimary: true }, 'item');
    expect(assignment.employeeId, employee.id); expect(assignment.merchantId, 'M1');
    expect((await request('POST', storesPath, { storeId: 'S1' })).status, 409);
    expect((await request('POST', storesPath, { storeId: 'S2', isPrimary: true })).status, 409);
    expect((await request('POST', storesPath, { storeId: 'OTHER' })).status, 404);
    expect((await request('POST', storesPath, { storeId: 'S2', effectiveFrom: '2026-10-02T00:00:00Z', effectiveUntil: '2026-10-01T00:00:00Z' })).status, 400);
    expect((await request('PATCH', storesPath + '/S1', { employeeId: randomUUID() })).status, 400);
    const rolePath = `/merchants/employees/employee-stores/${assignment.id}/roles`;
    expect((await request('POST', rolePath, { roleId: otherRole.id })).status, 404);
    await create(rolePath, { roleId: role.id }, 'item');
    for (const path of [storesPath, rolePath, `/merchants/M1/roles/${role.id}/permissions`, `/role-templates/${template}/permissions`, '/permissions', '/merchants/employees', '/merchants/M1/roles']) {
      expect((await request('GET', path, undefined, 'STAFF')).status, 403);
      expect((await request('GET', path, undefined, '')).status, 403);
    }
    expect((await request('GET', `/merchants/employees/${randomUUID()}/stores`)).status, 404);
    expect((await request('GET', `/merchants/employees/employee-stores/${randomUUID()}/roles`)).status, 404);
    const effectivePath = storesPath + '/S1/effective-access?permissionKey=POS_SALE_CREATE';
    const reason = async (expected: string) => {
      const response = await request('GET', effectivePath); expect(response.status, 200, JSON.stringify(response.data));
      expect(response.data.permissions[0].reason, expected); expect(response.data.permissions[0].allowed, expected === 'ALLOWED');
    };
    await reason('ALLOWED');
    await db.query('UPDATE plan_entitlements SET enabled=false'); await reason('FEATURE_NOT_ENTITLED');
    await db.query("INSERT INTO store_entitlements(store_id,feature_id,enabled) VALUES ('S1',$1,true)", [feature]);
    await reason('ALLOWED'); // Explicit store add-on override can grant a feature not in the base plan.
    await db.query("INSERT INTO subscription_entitlements(subscription_id,feature_id,enabled) VALUES ('SUB1',$1,true)", [feature]);
    await reason('ALLOWED');
    await db.query('UPDATE store_entitlements SET enabled=false'); await reason('STORE_FEATURE_DISABLED');
    await db.query('UPDATE store_entitlements SET effective_until=now()-interval \'1 day\''); await reason('ALLOWED');
    expect((await request('PATCH', rolePath + '/' + role.id, { effectiveFrom: '2099-01-01T00:00:00Z' })).status, 200);
    await reason('ROLE_MISSING');
    expect((await request('PUT', rolePath + '/' + role.id, {})).status, 200); await reason('ALLOWED');
    expect((await request('PATCH', `/merchants/M1/roles/${role.id}/permissions/${permission.id}`, { allowed: false })).status, 200);
    await reason('PERMISSION_MISSING');
    expect((await request('PATCH', storesPath + '/S1', { status: 'SUSPENDED' })).status, 200); await reason('STORE_ASSIGNMENT_MISSING');
    expect((await request('PUT', storesPath + '/S1', {})).status, 200);
    expect((await request('PATCH', `/merchants/employees/${employee.id}`, { status: 'INACTIVE' })).status, 200); await reason('EMPLOYEE_INACTIVE');
    expect((await request('PATCH', `/merchants/employees/${employee.id}`, { status: 'ACTIVE' })).status, 200);
    await db.query("UPDATE subscription_stores SET status='INACTIVE'"); await reason('STORE_NOT_LICENSED');
    expect((await request('DELETE', storesPath + '/S1')).status, 409, 'remove role links before assignment');
    expect((await request('DELETE', rolePath + '/' + role.id)).status, 200);
    expect((await request('DELETE', storesPath + '/S1')).status, 200);
    expect((await request('DELETE', `/merchants/M1/roles/${role.id}/permissions/${permission.id}`)).status, 200);
    expect((await request('DELETE', `/role-templates/${template}/permissions/${permission.id}`)).status, 200);
    expect((await request('GET', storesPath)).data.count, 0);
    // Restart-style initialization preserves populated records.
    await ensureEmployeeAccessSchema(db);
    expect((await request('GET', `/permissions/${permission.id}`)).data.permission.id, permission.id);
    console.log(`PASS ${checks} assertions: automatic schema creation, idempotency, CRUD, template copy, validation, tenant scope, owner guard, entitlement gates`);
  } finally {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (createdDatabase) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
