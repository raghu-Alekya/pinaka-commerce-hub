import assert from 'node:assert/strict';
import test from 'node:test';
import { MerchantRepository } from '../merchant/merchant.repository';
import { AppController } from './app.controller';

test('subcategory GET returns children from the synced category payload without calling WordPress', async () => {
  const categories = [
    { id: 23, name: 'Parent', parent: 0 },
    { id: 24, name: 'First child', parent: 23 },
    { id: 25, name: 'Second child', parent: '23' },
    { id: 26, name: 'Other child', parent: 99 },
  ];
  const repository = new MerchantRepository() as any;
  repository.getStoreById = async () => ({ id: 'store-id' });
  repository.getStoreCategoriesByStoreId = async () => categories;
  repository.getWebsiteConnection = async () => { throw new Error('WordPress must not be called'); };
  const controller = new AppController(repository, {} as any);

  assert.deepEqual(await controller.getStoreSubCategories('store-id', '23'), categories.slice(1, 3));
  repository.getStoreCategoriesByStoreId = async () => null;
  assert.deepEqual(await controller.getStoreSubCategories('store-id', '23'), []);
});

test('connector validation accepts the category API when generic WordPress checks are denied', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    return new Response('', { status: url.includes('/pinaka-pos/v1/categories/') ? 200 : 401 });
  };
  try {
    const controller = new AppController({} as any, {} as any) as any;
    const result = await controller.pingWordPress('https://example.com', 'token');
    assert.equal(result.ok, true);
    assert.match(result.message, /category API/);
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('category and subcategory reads use previously synced tax data when the category payload is empty', async () => {
  const repository = new MerchantRepository() as any;
  repository.ensureStoreCategoriesTable = async () => {};
  repository.dataSource = { query: async () => [{
    payload: [], categories: [], tags: [], attributes: [],
    categories_with_tax: { categories: [{ id: 23, name: 'Parent', parent: 0,
      children: [{ id: 24, name: 'Child' }] }] },
  }] };
  assert.equal((await repository.getStoreCategoriesByStoreId('store-id')).length, 2);
  assert.equal((await repository.getStoreSubCategoriesByStoreId('store-id', 23))[0].id, 24);
  assert.equal((await repository.getStoreCatalogTaxonomiesByStoreId('store-id')).categories.length, 2);
});

test('subcategory read uses saved tax children when an older payload contains only parents', async () => {
  const repository = new MerchantRepository() as any;
  repository.ensureStoreCategoriesTable = async () => {};
  repository.dataSource = { query: async () => [{
    payload: [{ id: 23, name: 'Parent', parent: 0 }],
    categories_with_tax: { categories: [{ id: 23, name: 'Parent', parent: 0,
      children: [{ id: 24, name: 'Child' }] }] },
  }] };

  assert.equal((await repository.getStoreCategoriesByStoreId('store-id')).length, 2);
  assert.equal((await repository.getStoreSubCategoriesByStoreId('store-id', 23))[0].id, 24);
  assert.equal((await repository.getStoreCatalogTaxonomiesByStoreId('store-id')).categories.length, 2);
});
