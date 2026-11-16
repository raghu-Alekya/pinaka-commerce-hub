import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderResponsePresenter } from '../../responses/order-response.presenter';
import { OrderUpdatePresenter } from './order-update.presenter';

function present(lineItems: unknown[], total: number) {
  const presenter = new OrderUpdatePresenter(new OrderResponsePresenter());
  return presenter.present({
    order: {
      id: 'order-1',
      orderNumber: '263099905',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      totalAmount: total,
      discountAmount: 0,
      taxAmount: 0,
      createdAt: new Date('2026-11-05T10:00:00Z'),
      updatedAt: new Date('2026-11-05T10:00:00Z'),
      metadata: [{ key: 'redeemed_value', value: 10 }],
      requestPayload: { created_via: 'rest-api', currency: 'USD' },
    },
    items: [],
    storeOrder: {
      status: 'completed',
      currency: 'USD',
      timezone: 'UTC',
      total,
      taxTotal: 0,
      discountTotal: 0,
      lineItems,
      feeLines: [],
      couponLines: [],
      taxLines: [],
      metadata: [{ key: 'redeemed_value', value: 10 }],
    },
  } as never) as { total: string; line_items: Array<Record<string, unknown>>; fee_lines: unknown[] };
}

test('order details add the loyalty discount fee without changing the total', () => {
  const response = present(
    [{ id: 'item-1', name: 'Product A', product_id: 10, quantity: 1, subtotal: '100.00', total: '100.00' }],
    108,
  );
  const loyalty = response.fee_lines.find((fee) => (fee as { name?: string }).name === 'loyalty_discount') as {
    name: string;
    total: string;
    tax_status: string;
  };
  assert.equal(loyalty.name, 'loyalty_discount');
  assert.equal(loyalty.total, '-10.00');
  assert.equal(loyalty.tax_status, 'none');
  assert.equal(response.total, '108.00');
});

test('order details do not add a second loyalty fee', () => {
  const presenter = new OrderUpdatePresenter(new OrderResponsePresenter());
  const response = presenter.present({
    order: {
      id: 'order-1',
      orderNumber: '263099905',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      totalAmount: 90,
      discountAmount: 0,
      taxAmount: 0,
      createdAt: new Date('2026-11-05T10:00:00Z'),
      updatedAt: new Date('2026-11-05T10:00:00Z'),
      metadata: [{ key: 'redeemed_value', value: 10 }],
      requestPayload: { created_via: 'rest-api', currency: 'USD' },
    },
    items: [],
    storeOrder: {
      status: 'completed',
      currency: 'USD',
      timezone: 'UTC',
      total: 90,
      taxTotal: 0,
      discountTotal: 0,
      lineItems: [],
      feeLines: [{ name: 'loyalty_discount', total: '-10.00', tax_status: 'none' }],
      couponLines: [],
      taxLines: [],
      metadata: [{ key: 'redeemed_value', value: 10 }],
    },
  } as never) as { total: string; fee_lines: Array<{ name?: string }> };
  assert.equal(response.fee_lines.filter((fee) => fee.name === 'loyalty_discount').length, 1);
  assert.equal(response.total, '90.00');
});
