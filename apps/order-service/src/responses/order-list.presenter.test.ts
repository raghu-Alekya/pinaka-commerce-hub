import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderListPresenter } from './order-list.presenter';

function row(status: string) {
  return {
    order: {
      id: '8c0ca90d-4af1-4489-b962-7c73d225e1aa',
      orderNumber: '2626',
      clientOrderId: '262860561',
      orderStatus: status === 'refunded' ? 'REFUNDED' : 'PARTIAL_REFUND',
      paymentStatus: 'PAID',
      totalAmount: 63.8,
      discountAmount: 0,
      taxAmount: 4.86,
      storeId: 'store-1',
      createdAt: new Date('2026-10-13T01:58:46Z'),
      updatedAt: new Date('2026-10-16T06:32:48Z'),
      requestPayload: {},
      metadata: [],
    },
    storeOrder: {
      status,
      total: 63.8,
      lineItems: [
        { id: 'ITEM-8c0ca90d-4af1-4489-b962-7c73d225e1aa-1', name: 'Coors Light', quantity: 1, total: '15.98' },
        { id: 'ITEM-8c0ca90d-4af1-4489-b962-7c73d225e1aa-2', name: 'Bigsip 4', quantity: 1, total: '3.99' },
      ],
    },
    items: [],
    products: new Map(),
    refunds: [{
      amount: '15.98',
      metadata: {
        line_items: [{ order_item_id: 'ITEM-8c0ca90d-4af1-4489-b962-7c73d225e1aa-1', quantity: 1 }],
      },
    }],
  } as any;
}

test('total-orders marks only partially refunded lines and reports refund totals', () => {
  const result = new OrderListPresenter().present(1, 10, 1, [row('partial-refund')]);
  const order = result.orders_data[0];
  assert.equal(order.line_items[0].is_refund_item, true);
  assert.equal(order.line_items[1].is_refund_item, false);
  assert.equal(order.refund_total, 15.98);
  assert.equal(order.net_payment, 42.96);
});

test('total-orders uses the repository effective refund status', () => {
  const partial = row('completed');
  partial.effectiveStatus = 'partial-refund';
  const refunded = row('completed');
  refunded.effectiveStatus = 'refunded';
  const result = new OrderListPresenter().present(1, 10, 2, [partial, refunded]);
  assert.equal(result.orders_data[0].status, 'Partial-refund');
  assert.equal(result.orders_data[1].status, 'Refunded');
});

test('total-orders requests latest-modified ordering', () => {
  const criteria = new OrderListPresenter().criteria({});
  assert.equal(criteria.orderBy, 'modified');
});

test('total-orders normalizes status aliases and preserves other filters', () => {
  const presenter = new OrderListPresenter();
  const criteria = presenter.criteria({
    page: '2',
    perPage: '25',
    status: 'partial_refund, canceled,ON HOLD,partial-refund',
    createdVia: ' REST-API ',
    storeId: ' store-1 ',
  });
  assert.equal(criteria.page, 2);
  assert.equal(criteria.perPage, 25);
  assert.deepEqual(criteria.statuses, ['partial-refund', 'cancelled', 'on-hold']);
  assert.equal(criteria.createdVia, 'REST-API');
  assert.equal(criteria.storeId, 'store-1');
});

test('total-orders treats all and any status aliases as unfiltered', () => {
  const presenter = new OrderListPresenter();
  assert.deepEqual(presenter.criteria({ status: 'all' }).statuses, []);
  assert.deepEqual(presenter.criteria({ status: 'any' }).statuses, []);
});

test('total-orders rejects invalid pagination', () => {
  const presenter = new OrderListPresenter();
  assert.throws(() => presenter.criteria({ page: '0' }), /page must be a whole number greater than 0/);
  assert.throws(() => presenter.criteria({ perPage: '101' }), /per_page cannot be greater than 100/);
});

test('total-orders does not mark individual lines on a fully refunded order', () => {
  const result = new OrderListPresenter().present(1, 10, 1, [row('refunded')]);
  assert.equal(result.orders_data[0].line_items[0].is_refund_item, false);
});
