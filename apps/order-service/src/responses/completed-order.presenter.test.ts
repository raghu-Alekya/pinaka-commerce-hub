import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CompletedOrderPresenter } from './completed-order.presenter';
import { OrderStatus, OrderType, PaymentMethod, PaymentStatus, type OrderEntity } from '../entities/order.entity';
import type { StoreOrderEntity } from '../entities/store-order.entity';

const presenter = new CompletedOrderPresenter();
const scope = {
  merchantId: 'cb1f2437-a9e9-4a2b-b044-caf7cdfac180',
  storeId: '2ad68afe-8203-44bf-9bad-c3b5ec01bfb0',
};

test('completed order criteria mirrors Woo defaults and filters', () => {
  const criteria = presenter.criteria({
    ...scope,
    author: '11',
    after: '2026-02-11',
    before: '2026-02-18',
  });
  assert.equal(criteria.page, 1);
  assert.equal(criteria.perPage, 100);
  // A partially refunded order still has a positive balance and therefore
  // remains in completed-orders until its final balance is refunded.
  assert.deepEqual(criteria.statuses, ['completed', 'partial-refund']);
  assert.equal(criteria.author, '11');
  assert.equal(criteria.after?.toISOString(), '2026-02-11T00:00:00.000Z');
  assert.equal(criteria.before?.toISOString(), '2026-02-18T23:59:59.999Z');
  assert.equal(criteria.orderBy, 'modified');
});

test('completed order presenter emits the Woo compatibility response', () => {
  const createdAt = new Date('2026-10-15T03:08:08.000Z');
  const updatedAt = new Date('2026-10-15T03:08:09.000Z');
  const order = {
    id: '93a2367d-7b2a-42c7-8da8-4262dc92acde',
    orderNumber: '17517',
    merchantId: 'cb1f2437-a9e9-4a2b-b044-caf7cdfac180',
    storeId: '2ad68afe-8203-44bf-9bad-c3b5ec01bfb0',
    clientOrderId: '262881247',
    customerName: 'Walk-in Customer',
    orderType: OrderType.IN_STORE_POS,
    paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID,
    subtotal: 16.88,
    taxAmount: 1.54,
    discountAmount: 0,
    tipAmount: 0,
    totalAmount: 18.42,
    orderStatus: OrderStatus.COMPLETED,
    requestPayload: { created_via: 'rest-api' },
    metadata: [],
    offline: false,
    createdAt,
    updatedAt,
  } as OrderEntity;
  const storeOrder = {
    currency: 'USD',
    timezone: 'UTC',
    status: 'completed',
    placedBy: '3',
    paymentMethod: 'cash',
    subtotal: 16.88,
    discountTotal: 0,
    feeTotal: 0,
    taxTotal: 1.54,
    total: 18.42,
    couponLines: [],
    feeLines: [],
    lineItems: [],
    payments: [{ id: 17518, payment_method: 'Cash', payment_amount: '20.42' }],
  } as unknown as StoreOrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder, items: [], products: new Map() }]);
  assert.equal(response.order_total_count, 1);
  assert.equal(response.orders_data[0].id, 17517);
  assert.equal(response.orders_data[0].order_id, 262881247);
  assert.equal(response.orders_data[0].status, 'completed');
  assert.equal(response.orders_data[0].amount, '16.88');
  assert.equal(response.orders_data[0].items_tax, '1.54');
  assert.equal(response.orders_data[0].total, '16.88');
  assert.equal(response.orders_data[0].transaction_id, '17518');
  assert.equal(response.orders_data[0].order_type, 'Shop Order');
});

test('completed-orders reports partial-refund only for a partially refunded order', () => {
  const createdAt = new Date('2026-10-15T03:08:08.000Z');
  const order = {
    id: '93a2367d-7b2a-42c7-8da8-4262dc92acde',
    orderNumber: '17517',
    merchantId: scope.merchantId,
    storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS,
    paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID,
    totalAmount: 18.42,
    requestPayload: {},
    metadata: [],
    createdAt,
    updatedAt: createdAt,
  } as OrderEntity;
  const row = { order, storeOrder: null, items: [], products: new Map() };

  const completed = presenter.present(1, 100, 1, [{ ...row, effectiveStatus: 'completed' }]);
  const partial = presenter.present(1, 100, 1, [{ ...row, effectiveStatus: 'partial-refund' }]);

  assert.equal(completed.orders_data[0].status, 'completed');
  assert.equal(partial.orders_data[0].status, 'Partially Refunded');
});

test('completed-orders shows only tax belonging to the remaining item quantities', () => {
  const createdAt = new Date('2026-10-15T03:08:08.000Z');
  const order = {
    id: '93a2367d-7b2a-42c7-8da8-4262dc92acde',
    orderNumber: '17517',
    merchantId: scope.merchantId,
    storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS,
    paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID,
    totalAmount: 22,
    taxAmount: 2,
    requestPayload: {},
    metadata: [],
    createdAt,
    updatedAt: createdAt,
  } as OrderEntity;
  const storeOrder = {
    taxTotal: 2,
    lineItems: [{
      id: 'item-1', product_id: 'product-1', name: 'Item', quantity: 2,
      subtotal: '20.00', total: '20.00', subtotal_tax: '2.00', total_tax: '2.00',
      taxes: [{ id: 1, subtotal: '2.00', total: '2.00' }],
    }],
  } as unknown as StoreOrderEntity;
  const refunds = [{ metadata: {
    refund_id: 'refund-1',
    line_items: [{ order_item_id: 'item-1', quantity: 1, refund_total: 10 }],
  } }];

  const response = presenter.present(1, 100, 1, [{
    order, storeOrder, items: [], products: new Map(), refunds, effectiveStatus: 'partial-refund',
  }]);

  assert.equal(response.orders_data[0].items_tax, '1.00');
  assert.equal(response.orders_data[0].amount, '11.00');
  assert.equal(response.orders_data[0].total, '11.00');
  assert.equal(response.orders_data[0].line_items[0].subtotal_tax, '1.00');
  assert.equal(response.orders_data[0].line_items[0].total_tax, '1.00');
  assert.equal(response.orders_data[0].line_items[0].taxes[0].total, '1.00');
});

test('completed order criteria rejects invalid pagination and date ranges', () => {
  assert.throws(() => presenter.criteria({ ...scope, perPage: '101' }), BadRequestException);
  assert.throws(
    () => presenter.criteria({ ...scope, after: '2026-02-19', before: '2026-02-18' }),
    BadRequestException,
  );
});

test('completed order criteria requires merchant and store headers', () => {
  assert.throws(
    () => presenter.criteria({ storeId: scope.storeId }),
    /x-merchant-id header is required/,
  );
  assert.throws(
    () => presenter.criteria({ merchantId: scope.merchantId }),
    /x-store-id header is required/,
  );
});
