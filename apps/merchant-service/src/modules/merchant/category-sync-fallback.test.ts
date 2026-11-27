import assert from 'node:assert/strict';
import test from 'node:test';
import { MerchantRepository } from './merchant.repository';

test('category sync saves the custom WordPress category tree when WooCommerce denies access', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/wp-json/wc/v3/products/categories')) return new Response('', { status: 401 });
    return Response.json({ categories: [
      { id: 23, name: 'Parent', parent: 0, subcategories: [{ id: 25, name: 'Nested child' }] },
      { id: 24, name: 'Child', parent: 23 },
    ] });
  };
  try {
    const repository = new MerchantRepository() as any;
    repository.ensureStoreCategoriesTable = async () => {};
    repository.dataSource = { query: async (sql: string, values: unknown[] = []) => {
      writes.push({ sql, values });
      return [];
    } };
    const count = await repository.syncStoreCategoriesFromWordPress({
      storeId: 'store-id', wordpressUrl: 'https://example.com', wordpressJwt: 'token', includeAll: true,
    });
    assert.equal(count, 3);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /pinaka-pos\/v1\/categories\/get-categories-with-tax/);
    const payload = writes.find((write) => write.sql.includes('DO UPDATE SET payload'));
    assert.ok(payload);
    assert.equal(JSON.parse(String(payload.values[1]))[1].parent, 23);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('category sync does not make an extra WordPress request for child_count', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    return Response.json([{ id: 52, name: 'CBD', parent: 0, child_count: 1 }]);
  };
  try {
    const repository = new MerchantRepository() as any;
    repository.ensureStoreCategoriesTable = async () => {};
    repository.dataSource = { query: async (sql: string, values: unknown[] = []) => {
      writes.push({ sql, values });
      return [];
    } };
    const count = await repository.syncStoreCategoriesFromWordPress({
      storeId: 'store-id', wordpressUrl: 'https://example.com', wordpressJwt: 'token', includeAll: true,
    });
    assert.equal(count, 1);
    assert.equal(requests.length, 1);
    const payload = writes.find((write) => write.sql.includes('DO UPDATE SET payload'));
    assert.ok(payload);
    assert.equal(JSON.parse(String(payload.values[1]))[0].id, 52);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
