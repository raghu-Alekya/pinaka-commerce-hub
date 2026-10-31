import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import test from 'node:test';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PosAuthService } from './pos-auth.service';

const password = 'admin@123';
const salt = randomBytes(16);
const passwordHash = `${salt.toString('base64url')}:${scryptSync(password, salt, 64).toString('base64url')}`;

function service(rows: { merchants?: any[]; stores?: any[] }) {
  const queries: string[] = [];
  const repository = {
    requireDataSource: () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM public.stores')) return rows.stores || [];
        if (sql.includes('FROM public.merchants m')) return rows.merchants || [];
        return [];
      },
    }),
  };
  return {
    queries,
    auth: new PosAuthService({} as any, {} as any, repository as any),
  };
}

const merchant = {
  id: 'merchant-1',
  merchantCode: 'MCH-1',
  merchantId: 'MCH-1',
  businessDisplayName: 'Akash',
  email: 'akash@example.com',
  status: 'ACTIVE',
  password: passwordHash,
};

const store = {
  id: 'store-1',
  storeCode: 'STR-00001',
  storeName: 'Main',
  status: 'ACTIVE',
};

test('merchant store login requires merchant, password, and the requested store', async () => {
  const { auth, queries } = service({ merchants: [merchant], stores: [store] });
  await assert.rejects(
    () => auth.merchantStoreLogin({ password, storeId: 'STR-00001' }),
    BadRequestException,
  );
  await assert.rejects(
    () => auth.merchantStoreLogin({ merchantIdentifier: 'akash@example.com', storeId: 'STR-00001' }),
    BadRequestException,
  );
  await assert.rejects(
    () => auth.merchantStoreLogin({ merchantIdentifier: 'akash@example.com', password }),
    BadRequestException,
  );

  const wrongPassword = service({ merchants: [merchant], stores: [store] });
  await assert.rejects(
    () => wrongPassword.auth.merchantStoreLogin({
      merchantIdentifier: 'akash@example.com',
      password: 'wrong-password',
      storeId: 'STR-00001',
    }),
    UnauthorizedException,
  );
  assert.equal(wrongPassword.queries.some((sql) => sql.includes('FROM public.stores')), false);

  const missingStore = service({ merchants: [merchant], stores: [] });
  await assert.rejects(
    () => missingStore.auth.merchantStoreLogin({
      merchantIdentifier: 'akash@example.com',
      password,
      storeId: 'STR-00001',
    }),
    NotFoundException,
  );

  const result = await auth.merchantStoreLogin({
    merchantIdentifier: 'akash@example.com',
    password,
    storeId: 'STR-00001',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.store.storeCode, 'STR-00001');
  assert.equal('password' in result.data.merchant, false);
  assert.match(queries.find((sql) => sql.includes('FROM public.merchants')) || '', /lower\(trim\(m\.email\)\) = lower\(trim\(\$1\)\)/);
  const storeSql = queries.find((sql) => sql.includes('FROM public.stores')) || '';
  assert.match(storeSql, /s\.merchant_id = \$1::uuid/);
  assert.match(storeSql, /lower\(s\.store_code\) = lower\(\$2\)/);
  assert.equal(storeSql.includes('lower(store_name)'), false);
  assert.equal(queries.filter((sql) => sql.includes('ORDER BY created_at')).length, 0);
});
