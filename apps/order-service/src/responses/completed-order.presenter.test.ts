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
  } as unknown as OrderEntity;
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
  assert.equal(response.orders_data[0].date, 'Oct 15, 2026');
  assert.equal(response.orders_data[0].date_modified, 'Oct 15, 2026');
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
  } as unknown as OrderEntity;
  const row = { order, storeOrder: null, items: [], products: new Map() };

  const completed = presenter.present(1, 100, 1, [{ ...row, effectiveStatus: 'completed' }]);
  const partial = presenter.present(1, 100, 1, [{ ...row, effectiveStatus: 'partial-refund' }]);

  assert.equal(completed.orders_data[0].status, 'completed');
  assert.equal(partial.orders_data[0].status, 'Partially Refunded');
});

test('completed-orders formats dates as abbreviated month, day, and year', () => {
  const createdAt = new Date('2026-10-22T12:00:00.000Z');
  const updatedAt = new Date('2026-10-23T12:00:00.000Z');
  const order = {
    id: 'order-1', orderNumber: '1', merchantId: scope.merchantId, storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS, paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID, totalAmount: 0, requestPayload: {}, metadata: [],
    createdAt, updatedAt,
  } as unknown as OrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder: null, items: [], products: new Map() }]);

  assert.equal(response.orders_data[0].date, 'Oct 22, 2026');
  assert.equal(response.orders_data[0].date_modified, 'Oct 23, 2026');
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
  } as unknown as OrderEntity;
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

test('completed-orders allocates merchant discount by each item total without tax', () => {
  const createdAt = new Date('2026-10-15T03:08:08.000Z');
  const order = {
    id: '93a2367d-7b2a-42c7-8da8-4262dc92acde', orderNumber: '17517',
    merchantId: scope.merchantId, storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS, paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID, totalAmount: 6, requestPayload: {}, metadata: [],
    createdAt, updatedAt: createdAt,
  } as unknown as OrderEntity;
  const storeOrder = {
    total: 6,
    discountTotal: 6,
    feeLines: [{ name: 'merchant_discount', total: '-6.00' }],
    lineItems: [
      { id: 'item-1', product_id: '1', name: 'One', quantity: 1, total: '4.00', total_tax: '1.00' },
      { id: 'item-2', product_id: '2', name: 'Two', quantity: 1, total: '4.00', total_tax: '2.00' },
      { id: 'item-3', product_id: '3', name: 'Three', quantity: 1, total: '1.00', total_tax: '0.00' },
      { id: 'cashback', name: 'Cashback', quantity: 1, total: '20.00', total_tax: '0.00' },
      {
        id: 'payout', name: 'Till withdrawal', quantity: 1, total: '10.00', total_tax: '0.00',
        meta_data: [{ key: '_pos_item_type', value: 'payout' }],
      },
    ],
  } as unknown as StoreOrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder, items: [], products: new Map() }]);
  const lines = response.orders_data[0].line_items;

  assert.deepEqual(lines.map((line) => line.merchant_discount), ['2.67', '2.67', '0.66', '0.00', '0.00']);
  assert.deepEqual(lines.map((line) => line.total_with_tax), ['2.33', '3.33', '0.34', '20.00', '10.00']);
  assert.equal(lines.reduce((sum, line) => sum + Number(line.merchant_discount), 0), 6);
});

test('completed-orders assigns merchant discount rounding cents exactly once', () => {
  const createdAt = new Date('2026-10-15T03:08:08.000Z');
  const order = {
    id: 'order-1', orderNumber: '1', merchantId: scope.merchantId, storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS, paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID, totalAmount: 2.99, requestPayload: {}, metadata: [],
    createdAt, updatedAt: createdAt,
  } as unknown as OrderEntity;
  const storeOrder = {
    feeLines: [{ name: 'merchant_discount_percentage', total: '-1.00' }],
    lineItems: [
      { id: '1', name: 'One', quantity: 1, total: '1.00', total_tax: '0.00' },
      { id: '2', name: 'Two', quantity: 1, total: '1.00', total_tax: '0.00' },
      { id: '3', name: 'Three', quantity: 1, total: '1.99', total_tax: '0.00' },
    ],
  } as unknown as StoreOrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder, items: [], products: new Map() }]);
  const allocated = response.orders_data[0].line_items.map((line) => Number(line.merchant_discount));
  assert.deepEqual(allocated, [0.25, 0.25, 0.5]);
  assert.equal(allocated.reduce((sum, amount) => sum + amount, 0), 1);
});

test('completed-orders combines coupon and merchant discounts per eligible item without tax', () => {
  const createdAt = new Date('2026-10-27T05:11:53.301Z');
  const order = {
    id: 'order-1', orderNumber: '1', merchantId: scope.merchantId, storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS, paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID, totalAmount: 28, requestPayload: {}, metadata: [],
    createdAt, updatedAt: createdAt,
  } as unknown as OrderEntity;
  const storeOrder = {
    total: 28,
    taxTotal: 3,
    feeLines: [{ name: 'merchant_discount', total: '-2.00' }],
    couponLines: [{ code: 'SAVE3', discount: '3.00' }],
    lineItems: [
      {
        id: '1', name: 'One', quantity: 1, subtotal: '10.00', total: '9.00', total_tax: '1.00',
        taxes: [{ id: 10, subtotal: '1.00', total: '1.00' }],
      },
      {
        id: '2', name: 'Two', quantity: 1, subtotal: '20.00', total: '18.00', total_tax: '2.00',
        taxes: [{ id: 10, subtotal: '2.00', total: '2.00' }],
      },
    ],
  } as unknown as StoreOrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder, items: [], products: new Map() }]);
  const lines = response.orders_data[0].line_items;

  assert.deepEqual(lines.map((line) => line.coupon_discount), ['1.00', '2.00']);
  assert.deepEqual(lines.map((line) => line.merchant_discount), ['0.67', '1.33']);
  assert.deepEqual(lines.map((line) => line.total_discount), ['1.67', '3.33']);
  assert.deepEqual(lines.map((line) => line.total_tax), ['0.83', '1.67']);
  assert.deepEqual(lines.map((line) => line.total_with_tax), ['9.16', '18.34']);
  assert.equal(response.orders_data[0].items_tax, '2.50');
  assert.equal(response.orders_data[0].amount, '25.00');
  assert.equal(response.orders_data[0].total, '27.50');
  assert.equal(lines.reduce((sum, line) => sum + Number(line.total_discount), 0), 5);
});

test('completed-orders reconciles its header total after item-level tax rounding', () => {
  const createdAt = new Date('2026-10-27T08:56:26.053Z');
  const order = {
    id: 'order-4709', orderNumber: '4709', merchantId: scope.merchantId, storeId: scope.storeId,
    orderType: OrderType.IN_STORE_POS, paymentMethod: PaymentMethod.CASH,
    paymentStatus: PaymentStatus.PAID, totalAmount: 34.14, taxAmount: 1.18,
    requestPayload: {}, metadata: [
      { key: 'pos_cash_received', value: '39.58' },
      { key: 'pos_change_returned', value: '0.00' },
    ], createdAt, updatedAt: createdAt,
  } as unknown as OrderEntity;
  const merchandise = [
    ['2.99', '2.24', '0.24'], ['3.99', '2.99', '0.32'],
    ['3.99', '2.99', '0.32'], ['8.99', '6.74', '0.74'],
  ].map(([subtotal, total, tax], index) => ({
    id: String(index + 1), name: `Item ${index + 1}`, quantity: 1, subtotal, total,
    total_tax: tax, taxes: [{ id: 9.1, subtotal: tax, total: tax }],
  }));
  const storeOrder = {
    total: 34.14,
    taxTotal: 1.18,
    couponLines: [{ code: '2025', discount: '5.00' }],
    feeLines: [
      { name: 'Cashback Fee', total: '10.00' },
      { name: 'merchant_discount', total: '-2.00' },
    ],
    lineItems: [
      ...merchandise,
      { id: 'payout', name: 'Payout', quantity: 1, subtotal: '-20.00', total: '-20.00', total_tax: '0.00' },
      { id: 'cashback', name: 'Cashback', quantity: 1, subtotal: '30.00', total: '30.00', total_tax: '0.00' },
    ],
  } as unknown as StoreOrderEntity;

  const response = presenter.present(1, 100, 1, [{ order, storeOrder, items: [], products: new Map() }]);
  const presented = response.orders_data[0];

  assert.equal(presented.items_tax, '1.19');
  assert.equal(presented.amount, '32.96');
  assert.equal(presented.total, '34.15');
  assert.equal(presented.cash_received, '39.58');
  assert.equal(presented.change_amount, '5.43');
  assert.deepEqual(
    presented.line_items.slice(0, 4).map((line) => line.subtotal_tax),
    ['0.27', '0.36', '0.36', '0.82'],
  );
  assert.deepEqual(
    presented.line_items.slice(0, 4).map((line) => line.taxes[0].subtotal),
    ['0.27', '0.36', '0.36', '0.82'],
  );
  assert.equal(presented.line_items.slice(0, 4)
    .reduce((sum, line) => sum + Number(line.total_with_tax), 0), 14.15);
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
