import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allows,
  isPlatformMasterPath,
  merchantGrants,
  moduleForPath,
  sameMerchant,
} from './console-access';

test('merchant grants include console modules and exclude platform master data', () => {
  const keys = merchantGrants().map((grant) => grant.menuKey);
  assert.equal(keys.includes('stores'), true);
  assert.equal(keys.includes('access-permissions'), true);
  assert.equal(keys.includes('merchants'), false);
  assert.equal(keys.includes('role-templates'), false);
  assert.deepEqual(merchantGrants().find((grant) => grant.menuKey === 'dashboard')?.actions, ['view']);
});

test('platform master paths stay restricted and merchant store paths do not', () => {
  assert.equal(isPlatformMasterPath('/api/v1/role-templates'), true);
  assert.equal(isPlatformMasterPath('/api/v1/merchants'), false);
  assert.equal(isPlatformMasterPath('/api/v1/merchants/merchant-1/roles'), false);
  assert.equal(moduleForPath('/api/v1/merchants/merchant-1/access/roles/role-1/grants'), 'access-permissions');
  assert.equal(moduleForPath('/connector/api/v1/stores'), 'stores');
  assert.equal(allows(merchantGrants(), 'stores', 'view'), true);
  assert.equal(sameMerchant('MCH-1', 'merchant-uuid', 'MCH-1'), true);
  assert.equal(sameMerchant('other', 'merchant-uuid', 'MCH-1'), false);
});
