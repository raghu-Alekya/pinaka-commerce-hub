import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderRepository } from './order.repository';

function tracker(initial: Record<string, any>) {
  let payload = structuredClone(initial);
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      if (/SELECT payload FROM public\.store_discounts/i.test(sql)) return [{ payload }];
      if (/UPDATE public\.store_discounts/i.test(sql)) payload = JSON.parse(String(parameters[1]));
      return [];
    },
  };
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const track = (orderId: string, lineItems: any[], paymentStatus = 'PAID', status = 'CREATED') =>
    (repository as any).recordCustomDiscountUsage(
      manager, 'store-1', orderId, paymentStatus, status, status, [], [], lineItems,
    );
  return { track, snapshot: () => payload };
}

const linesFor = (ruleId: string, applications: number) => Array.from({ length: applications }, () => ({
  meta_data: [{ key: '_pos_discount_rule_id', value: ruleId }],
}));

test('usage counts every repeated application, accumulates across orders, and is retry-safe', async () => {
  const state = tracker({ auto: [{ id: 73, name: 'Diwali Mix', usage_count: 0, usage_limit: null }], mix_match: [], multipack: [] });
  await state.track('order-1', linesFor('AUTO_73', 10));
  await state.track('order-2', linesFor('auto_73', 5));
  await state.track('order-2', linesFor('AUTO_73', 5));
  await state.track('order-3', linesFor('AUTO_73', 3));
  await state.track('order-3', linesFor('AUTO_73', 3));
  assert.equal(state.snapshot().auto[0].usage_count, 18);
  assert.deepEqual(state.snapshot().auto[0].pch_used_order_ids, ['order-1', 'order-2', 'order-3']);
  assert.deepEqual(state.snapshot().auto[0].pch_used_applications_by_order, { 'order-1': 10, 'order-2': 5, 'order-3': 3 });
  assert.equal(state.snapshot().auto[0].name, 'Diwali Mix');
});

test('auto, mix_match, and multipack rule IDs match their catalog IDs', async () => {
  const state = tracker({
    auto: [{ id: 11, usage_count: 0 }],
    mix_match: [{ id: 22, usage_count: 0 }],
    multipack: [{ id: 33, usage_count: 0 }],
  });
  await state.track('order-1', [
    ...linesFor('AUTO_11', 2), ...linesFor('MM_22', 3), ...linesFor('MP_33', 4),
  ]);
  assert.deepEqual([
    state.snapshot().auto[0].usage_count,
    state.snapshot().mix_match[0].usage_count,
    state.snapshot().multipack[0].usage_count,
  ], [2, 3, 4]);
});

test('a POS application-count marker records repeated uses on one line item', async () => {
  const state = tracker({ auto: [{ id: 73, usage_count: 0 }], mix_match: [], multipack: [] });
  await state.track('order-1', [{ meta_data: [
    { key: '_pos_discount_rule_id', value: 'AUTO_73' },
    { key: '_pos_discount_application_count', value: 10 },
  ] }]);
  assert.equal(state.snapshot().auto[0].usage_count, 10);
});

test('failed and cancelled orders do not increment usage', async () => {
  const state = tracker({ auto: [{ id: 73, usage_count: 0 }], mix_match: [], multipack: [] });
  await state.track('failed', linesFor('AUTO_73', 10), 'PAID', 'FAILED');
  await state.track('cancelled', linesFor('AUTO_73', 10), 'PAID', 'CANCELLED');
  await state.track('unpaid', linesFor('AUTO_73', 10), 'PENDING', 'CREATED');
  assert.equal(state.snapshot().auto[0].usage_count, 0);
});

test('revised order application count applies only the delta and can remove prior usage', async () => {
  const state = tracker({ auto: [{
    id: 73, usage_count: 10, pch_used_order_ids: ['order-1'],
    pch_used_applications_by_order: { 'order-1': 10 },
  }], mix_match: [], multipack: [] });
  await state.track('order-1', linesFor('AUTO_73', 7));
  assert.equal(state.snapshot().auto[0].usage_count, 7);
  await state.track('order-1', []);
  assert.equal(state.snapshot().auto[0].usage_count, 0);
});

