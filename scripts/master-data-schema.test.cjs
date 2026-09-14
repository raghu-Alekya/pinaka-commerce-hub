// Requires a disposable PostgreSQL instance: PCH_SCHEMA_TEST_DATABASE_URL.
// Creates randomly named schemas and removes only those schemas in finally.
const { Client } = require('pg');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const url = process.env.PCH_SCHEMA_TEST_DATABASE_URL;
if (!url) throw new Error('Set PCH_SCHEMA_TEST_DATABASE_URL to a disposable PostgreSQL database');
const client = new Client({ connectionString: url });
const root = join(__dirname, '..', 'docs', 'sql');
const canonical = readFileSync(join(root, 'pch_master_data_schema.sql'), 'utf8');
const migration = readFileSync(join(root, '03_master_data_relationships.sql'), 'utf8');
const relationshipTables = ['store_type_features', 'store_type_role_templates', 'plan_entitlements',
  'subscription_stores', 'subscription_entitlements', 'store_entitlements', 'employee_stores',
  'employee_store_roles', 'role_template_permissions', 'role_permissions'];
let checks = 0;

async function rejects(sql, args, code) {
  await client.query('SAVEPOINT expected_failure');
  try {
    await assert.rejects(client.query(sql, args), error => error.code === code);
    checks++;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}

async function exercise(schema, legacy) {
  await client.query(`SET search_path TO ${schema}, pg_catalog`);
  await client.query('BEGIN');
  const merchant = legacy ? 'MCH-1' : randomUUID();
  const otherMerchant = legacy ? 'MCH-2' : randomUUID();
  const store = legacy ? 'STR-1' : randomUUID();
  const otherStore = legacy ? 'STR-2' : randomUUID();
  const subscription = legacy ? 'SUB-1' : randomUUID();
  const type = randomUUID(), feature = randomUUID(), permission = randomUUID();
  const template = randomUUID(), plan = randomUUID(), employee = randomUUID(), otherEmployee = randomUUID();
  const role = randomUUID(), otherRole = randomUUID(), assignment = randomUUID();
  if (legacy) {
    await client.query('INSERT INTO merchants VALUES ($1), ($2)', [merchant, otherMerchant]);
    await client.query('INSERT INTO stores VALUES ($1,$2), ($3,$4)', [store, merchant, otherStore, otherMerchant]);
    await client.query('INSERT INTO subscriptions VALUES ($1,$2)', [subscription, merchant]);
    for (const [table,id] of [['store_types',type],['features',feature],['permissions',permission],['role_templates',template],['plans',plan]]) {
      await client.query(`INSERT INTO ${table} VALUES ($1)`, [id]);
    }
    await client.query('INSERT INTO employees VALUES ($1,$2), ($3,$4)', [employee,merchant,otherEmployee,otherMerchant]);
    await client.query('INSERT INTO roles VALUES ($1,$2), ($3,$4)', [role,merchant,otherRole,otherMerchant]);
  } else {
    await client.query("INSERT INTO merchants (id,merchant_code,business_name) VALUES ($1,'M1','First'),($2,'M2','Second')", [merchant,otherMerchant]);
    await client.query("INSERT INTO store_types (id,store_type_code,name) VALUES ($1,'GROCERY','Grocery')", [type]);
    await client.query("INSERT INTO stores (id,merchant_id,store_type_id,store_code,name) VALUES ($1,$2,$3,'S1','First'),($4,$5,$3,'S2','Second')", [store,merchant,type,otherStore,otherMerchant]);
    await client.query("INSERT INTO features (id,feature_key,name,feature_type) VALUES ($1,'REFUNDS','Refunds','BOOLEAN')", [feature]);
    await client.query("INSERT INTO permissions (id,feature_id,permission_key,name) VALUES ($1,$2,'CREATE_REFUND','Create refund')", [permission,feature]);
    await client.query("INSERT INTO role_templates (id,role_code,name,scope_type) VALUES ($1,'CASHIER','Cashier','STORE')", [template]);
    await client.query("INSERT INTO plans (id,plan_code,name) VALUES ($1,'PRO','Pro')", [plan]);
    await client.query("INSERT INTO subscriptions (id,subscription_code,merchant_id,plan_id,status) VALUES ($1,'SUB1',$2,$3,'ACTIVE'),(gen_random_uuid(),'SUB2',$2,$3,'CANCELLED')", [subscription,merchant,plan]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM subscriptions WHERE merchant_id=$1', [merchant])).rows[0].n, 2);
    checks++;
    await client.query("INSERT INTO employees (id,merchant_id,employee_code,first_name) VALUES ($1,$2,'E1','First'),($3,$4,'E2','Second')", [employee,merchant,otherEmployee,otherMerchant]);
    await client.query("INSERT INTO roles (id,merchant_id,role_code,name,scope_type) VALUES ($1,$2,'CASHIER','Cashier','STORE'),($3,$4,'MANAGER','Manager','STORE')", [role,merchant,otherRole,otherMerchant]);
    await rejects("INSERT INTO stores (merchant_id,store_type_id,store_code,name) VALUES ($1,$2,'BAD','Bad')", [merchant,randomUUID()], '23503');
    await rejects('UPDATE subscriptions SET plan_id=$1 WHERE id=$2', [randomUUID(),subscription], '23503');
    await rejects("UPDATE features SET feature_type='UNKNOWN' WHERE id=$1", [feature], '23514');
  }
  const pairs = [
    ['store_type_features','store_type_id','feature_id',type,feature],
    ['store_type_role_templates','store_type_id','role_template_id',type,template],
    ['plan_entitlements','plan_id','feature_id',plan,feature],
    ['subscription_entitlements','subscription_id','feature_id',subscription,feature],
    ['store_entitlements','store_id','feature_id',store,feature],
    ['role_template_permissions','role_template_id','permission_id',template,permission],
    ['role_permissions','role_id','permission_id',role,permission],
  ];
  for (const [table,left,right,l,r] of pairs) {
    const sql = `INSERT INTO ${table} (${left},${right}) VALUES ($1,$2)`;
    await client.query(sql,[l,r]); checks++;
    await rejects(sql,[l,r],'23505');
    await rejects(sql,[l,randomUUID()],'23503');
  }
  await client.query("INSERT INTO subscription_stores (merchant_id,subscription_id,store_id,status) VALUES ($1,$2,$3,'ACTIVE')", [merchant,subscription,store]);
  await client.query('INSERT INTO employee_stores (id,merchant_id,employee_id,store_id) VALUES ($1,$2,$3,$4)', [assignment,merchant,employee,store]);
  await client.query('INSERT INTO employee_store_roles (merchant_id,employee_store_id,role_id) VALUES ($1,$2,$3)', [merchant,assignment,role]);
  checks += 3;
  await rejects("INSERT INTO subscription_stores (merchant_id,subscription_id,store_id,status) VALUES ($1,$2,$3,'ACTIVE')", [merchant,subscription,otherStore], '23503');
  await rejects('INSERT INTO employee_stores (merchant_id,employee_id,store_id) VALUES ($1,$2,$3)', [merchant,employee,otherStore], '23503');
  await rejects('INSERT INTO employee_stores (merchant_id,employee_id,store_id) VALUES ($1,$2,$3)', [merchant,otherEmployee,store], '23503');
  await rejects('INSERT INTO employee_store_roles (merchant_id,employee_store_id,role_id) VALUES ($1,$2,$3)', [merchant,assignment,otherRole], '23503');
  await rejects('UPDATE employee_store_roles SET merchant_id=$1', [otherMerchant], '23503');
  await rejects('DELETE FROM employee_stores WHERE id=$1', [assignment], '23503');
  await rejects('UPDATE roles SET merchant_id=$1 WHERE id=$2', [otherMerchant,role], '23503');
  for (const table of ['employee_stores','employee_store_roles','subscription_entitlements','store_entitlements']) {
    await rejects(`UPDATE ${table} SET effective_from='2026-10-01',effective_until='2026-09-01'`, [], '23514');
  }
  await rejects("UPDATE subscription_stores SET activated_at='2026-10-01',deactivated_at='2026-09-01'", [], '23514');
  await client.query('ROLLBACK');
}

async function main() {
  await client.connect();
  for (const mode of ['canonical','legacy_snake','legacy_camel']) {
    const schema = `pch_test_${randomUUID().replaceAll('-','')}`;
    const rewrite = text => text.replaceAll('public.', `${schema}.`).replaceAll('search_path = public,', `search_path = ${schema},`);
    await client.query(`CREATE SCHEMA ${schema}`);
    try {
      if (mode === 'canonical') {
        await client.query(rewrite(canonical));
        assert.equal((await client.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_type=\'BASE TABLE\'', [schema])).rows[0].n, 20);
        checks++;
      } else {
        const owner = mode === 'legacy_camel' ? '"merchantId"' : 'merchant_id';
        await client.query(`SET search_path TO ${schema}, pg_catalog;
          CREATE TABLE merchants (id varchar(100) PRIMARY KEY);
          CREATE TABLE stores (id varchar(100) PRIMARY KEY, ${owner} varchar(100) NOT NULL REFERENCES merchants(id));
          CREATE TABLE subscriptions (id varchar(100) PRIMARY KEY, ${owner} varchar(100) NOT NULL REFERENCES merchants(id));
          CREATE TABLE employees (id uuid PRIMARY KEY, merchant_id varchar(100) NOT NULL REFERENCES merchants(id));
          CREATE TABLE roles (id uuid PRIMARY KEY, merchant_id varchar(100) NOT NULL REFERENCES merchants(id));
          CREATE TABLE store_types (id uuid PRIMARY KEY);
          CREATE TABLE features (id uuid PRIMARY KEY);
          CREATE TABLE permissions (id uuid PRIMARY KEY);
          CREATE TABLE role_templates (id uuid PRIMARY KEY);
          CREATE TABLE plans (id uuid PRIMARY KEY);`);
      }
      await client.query(rewrite(migration));
      await client.query(rewrite(migration)); // Idempotence on a matching schema.
      const actual = (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', [schema])).rows.map(r=>r.table_name);
      for (const table of relationshipTables) assert.ok(actual.includes(table), table);
      checks += relationshipTables.length;
      await exercise(schema, mode !== 'canonical');
      console.log(`PASS ${mode}: creation, repeat migration, valid links, uniqueness, orphan rejection, tenant isolation and date checks`);
    } finally {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
  console.log(`PASS ${checks} schema assertions`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => client.end());
