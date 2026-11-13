import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionForMethod,
  allows,
  collectMerchantIds,
  collectStoreIds,
  grantsFromKeys,
  intersectGrants,
  isMerchantDirectory,
  isPlatformMasterPath,
  merchantGrants,
  moduleForPath,
  sameMerchant,
} from './console-access';

test('merchant grants cover business modules and not platform master data', () => {
  const keys = merchantGrants().map((grant) => grant.menuKey);
  assert.equal(keys.includes('products'), true);
  assert.equal(keys.includes('access-permissions'), true);
  assert.equal(keys.includes('role-templates'), false);
  assert.deepEqual(merchantGrants().find((grant) => grant.menuKey === 'dashboard')?.actions, ['view']);
  assert.equal(merchantGrants().find((grant) => grant.menuKey === 'products')?.actions.includes('delete'), true);
});

test('path mapping distinguishes modules and skips auth profile routes', () => {
  assert.equal(moduleForPath('/api/v1/merchants/abc/stores/store-1'), 'stores');
  assert.equal(moduleForPath('/api/v1/employees/emp-1'), 'employees');
  assert.equal(moduleForPath('/api/v1/merchants/abc/roles/role-1'), 'access-permissions');
  assert.equal(moduleForPath('/api/v1/pos/auth/console/me'), null);
  assert.equal(actionForMethod('PATCH'), 'update');
  assert.equal(actionForMethod('DELETE'), 'delete');
});

test('store and merchant lists are not platform administration', () => {
  assert.equal(isMerchantDirectory('/api/v1/merchants'), true);
  assert.equal(isMerchantDirectory('/connector/api/v1/merchants'), true);
  assert.equal(isMerchantDirectory('/api/v1/merchants/abc/stores'), false);
  assert.equal(isPlatformMasterPath('/api/v1/merchants'), false);
  assert.equal(isPlatformMasterPath('/connector/api/v1/stores'), false);
  assert.equal(isPlatformMasterPath('/api/v1/role-templates'), true);
  assert.equal(isPlatformMasterPath('/api/v1/merchants/abc/stores/s1/role-templates'), false);
});

test('collected ids ignore reserved segments and match merchant code', () => {
  const request = {
    path: '/api/v1/merchants/employees',
    params: {},
    query: { merchantId: 'M-1' },
    headers: { 'x-store-id': 'store-9' },
  };
  assert.deepEqual(collectMerchantIds(request), ['M-1']);
  assert.deepEqual(collectStoreIds({ ...request, path: '/api/v1/stores/bulk' }), ['store-9']);
  assert.equal(sameMerchant('m-1', 'uuid', 'M-1'), true);
  assert.equal(sameMerchant('other', 'uuid', 'M-1'), false);
});

test('employee grants cannot exceed the actions they already hold', () => {
  const held = grantsFromKeys(['products.view', 'products.create']);
  assert.equal(allows(held, 'products', 'delete'), false);
  const filtered = intersectGrants(
    [{ menuKey: 'products', actions: ['view', 'create', 'delete'] }, { menuKey: 'orders', actions: ['view'] }],
    held,
  );
  assert.deepEqual(filtered, [{ menuKey: 'products', actions: ['view', 'create'] }]);
});
