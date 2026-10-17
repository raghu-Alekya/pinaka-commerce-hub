import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DashboardFeaturesService, summarizeFeatures } from './dashboard_features.service';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.MERCHANT_SERVICE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.MERCHANT_SERVICE_URL;
  else process.env.MERCHANT_SERVICE_URL = originalUrl;
});

test('feature counts use distinct codes from active, eligible plans and reconcile', () => {
  const result = summarizeFeatures(
    [
      { id: 'feature-1', feature_code: 'CATALOG', status: 'ACTIVE' },
      { id: 'feature-2', feature_code: 'POS', status: 'ACTIVE' },
      { id: 'feature-3', feature_code: 'REPORTS', status: 'INACTIVE' },
    ],
    [
      { status: 'ACTIVE', included_features: ['catalog', 'pos'] },
      { status: 'ACTIVE', included_features: ['CATALOG'] },
      { status: 'INACTIVE', included_features: ['REPORTS'] },
      { status: 'ACTIVE', is_deleted: true, included_features: ['REPORTS'] },
    ],
  );

  assert.deepEqual(result, {
    total_features_count: 3,
    active_features_count: 2,
    inactive_features_count: 1,
    included_in_plans_count: 2,
    not_included_in_any_plan_count: 1,
  });
});

test('dashboard feature service combines existing merchant-service read APIs', async () => {
  process.env.MERCHANT_SERVICE_URL = 'http://merchant.test';
  const urls: string[] = [];
  let planAuthorization: string | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/plans')) {
      planAuthorization = (init?.headers as Record<string, string> | undefined)?.authorization;
    }
    const payload = url.endsWith('/features')
      ? { success: true, features: [{ id: 'feature-1', feature_code: 'POS', status: 'ACTIVE' }] }
      : { success: true, plans: [{ status: 'ACTIVE', enabled_entitlement_feature_ids: ['feature-1'] }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  const result = await new DashboardFeaturesService().get_features({}, 'Bearer postman-token');
  assert.deepEqual(urls.sort(), [
    'http://merchant.test/api/v1/features',
    'http://merchant.test/api/v1/plans',
  ]);
  assert.deepEqual(result.data, {
    total_features_count: 1,
    active_features_count: 1,
    inactive_features_count: 0,
    included_in_plans_count: 1,
    not_included_in_any_plan_count: 0,
  });
  assert.equal(result.success, true);
  assert.ok(Number.isFinite(Date.parse(result.last_updated)));
  assert.equal(planAuthorization, 'Bearer postman-token');
});
