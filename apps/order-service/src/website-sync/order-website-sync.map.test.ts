import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWooOrderPayload, findSyncedWebsiteOrder } from './order-website-sync.map';

test('website order payload keeps the POS line, payment, and identity', () => {
  const payload = buildWooOrderPayload({
    orderId: '76ed0f94-a6fe-486c-a9d2-f126f4526900',
    clientOrderId: '262995440',
    customerName: 'Walk-in Customer',
    request: {
      status: 'completed',
      payment_method: 'cash',
      payment_method_title: 'POS-CASH',
      set_paid: true,
      line_items: [{ product_id: 2587, name: 'Cheetos', quantity: 2, subtotal: '9.98', total: '9.98' }],
      fee_lines: [{ name: 'merchant_discount', total: '-1.00', tax_status: 'none' }],
      coupon_lines: [{ code: 'SAVE1' }],
      meta_data: [{ key: 'shift_id', value: '64207' }],
    },
  });

  assert.equal(payload.status, 'completed');
  assert.equal(payload.payment_method, 'cash');
  assert.equal(payload.transaction_id, '262995440');
  assert.deepEqual(payload.line_items, [{
    product_id: 2587,
    name: 'Cheetos',
    quantity: 2,
    subtotal: '9.98',
    total: '9.98',
  }]);
  assert.deepEqual(payload.fee_lines, [{ name: 'merchant_discount', total: '-1.00', tax_status: 'none', tax_class: '' }]);
  assert.deepEqual(payload.coupon_lines, [{ code: 'SAVE1' }]);
  const meta = payload.meta_data as Array<{ key: string; value: unknown }>;
  assert.equal(meta.find((entry) => entry.key === '_pch_order_id')?.value, '76ed0f94-a6fe-486c-a9d2-f126f4526900');
  assert.equal(meta.find((entry) => entry.key === '_pos_client_order_id')?.value, '262995440');
});

test('a retried website sync recognizes the order already created for this POS order', () => {
  const orderId = '76ed0f94-a6fe-486c-a9d2-f126f4526900';
  assert.equal(findSyncedWebsiteOrder([
    { id: 88, meta_data: [{ key: '_pch_order_id', value: 'someone-else' }] },
    { id: 91, meta_data: [{ key: '_pch_order_id', value: orderId }] },
  ], orderId), 91);
  assert.equal(findSyncedWebsiteOrder([{ id: 88, meta_data: [] }], orderId), undefined);
});
