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

test('total-orders preserves the saved item-rounded tax for order 262976097', () => {
  const sample = row('completed');
  sample.order.clientOrderId = '262976097';
  sample.order.taxAmount = 2.95;
  sample.storeOrder.taxTotal = 2.95;
  sample.storeOrder.total = 32.31;
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '2.95' }];
  sample.storeOrder.lineItems = ['3.39', '2.99', '2.59', '1.99', '4.69', '4.59', '3.39', '3.89', '4.79']
    .map(total => ({ total, quantity: 1, tax_class: '' }));
  const result = new OrderListPresenter().present(1, 10, 1, [sample]);
  assert.equal(result.orders_data[0].total_tax, '2.95');
});

test('total-orders rounds merchant-only tax once for order 263027404', () => {
  const sample = row('completed');
  sample.order.orderNumber = '8426';
  sample.order.clientOrderId = '263027404';
  sample.order.totalAmount = 53.98;
  sample.order.discountAmount = 20.50;
  sample.order.taxAmount = 4.49;
  sample.storeOrder.total = 53.98;
  sample.storeOrder.discountTotal = 20.50;
  sample.storeOrder.taxTotal = 4.49;
  sample.storeOrder.couponLines = [];
  sample.storeOrder.feeLines = [{ name: 'merchant_discount', total: '-5.50', tax_status: 'none' }];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '4.49' }];
  sample.storeOrder.lineItems = [
    ['11.38', '0.94'], ['2.89', '0.23'], ['11.98', '0.98'],
    ['3.98', '0.32'], ['4.09', '0.33'], ['20.67', '1.69'],
  ].map(([total, tax]) => ({
      name: 'Item', quantity: 1, subtotal: total, total,
      subtotal_tax: tax, total_tax: tax,
      taxes: [{ id: 9.1, subtotal: tax, total: tax }],
    }));
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '4.5');
  assert.equal(order.total, '53.99');
  assert.equal(order.net_payment, 53.99);
});

test('total-orders calculates merchant-discount tax on the combined base for Woo order 3290', () => {
  const sample = row('completed');
  sample.order.orderNumber = '3290';
  sample.order.clientOrderId = '3290';
  sample.order.totalAmount = 27.43;
  sample.order.discountAmount = 2.80;
  sample.order.taxAmount = 2.27;
  sample.storeOrder.total = 27.43;
  sample.storeOrder.discountTotal = 2.80;
  sample.storeOrder.taxTotal = 2.27;
  sample.storeOrder.couponLines = [];
  sample.storeOrder.feeLines = [{ name: 'merchant_discount', total: '-2.80', tax_status: 'none' }];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '2.27' }];
  sample.storeOrder.lineItems = [
    ['2.99', '0.24'], ['3.99', '0.32'], ['3.99', '0.32'], ['16.99', '1.39'],
  ].map(([total, tax]) => ({
    name: 'Item', quantity: 1, subtotal: total, total,
    subtotal_tax: tax, total_tax: tax,
    taxes: [{ id: 9.1, subtotal: tax, total: tax }],
  }));
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.woo_order_id, 3290);
  assert.equal(order.total_tax, '2.29');
  assert.equal(order.total, '27.45');
  assert.equal(order.net_payment, 27.45);
});

test('total-orders applies the coupon before tax for Woo order 6226', () => {
  const sample = row('completed');
  sample.order.orderNumber = '6226';
  sample.order.clientOrderId = '6226';
  sample.order.totalAmount = 44.50;
  sample.order.discountAmount = 5;
  sample.order.taxAmount = 4.55;
  sample.storeOrder.total = 44.50;
  sample.storeOrder.discountTotal = 5;
  sample.storeOrder.taxTotal = 4.55;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [{ name: 'coupon_discount', total: '-5.00', tax_status: 'none' }];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '4.55' }];
  sample.storeOrder.lineItems = [{
    name: 'Products', quantity: 5, subtotal: '49.95', total: '49.95',
    subtotal_tax: '4.55', total_tax: '4.55',
    taxes: [{ id: 9.1, subtotal: '4.55', total: '4.55' }],
  }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.woo_order_id, 6226);
  assert.equal(order.total_tax, '4.09');
  assert.equal(order.total, '49.04');
  assert.equal(order.net_payment, 49.04);
});

test('total-orders uses coupon fee when coupon line omits its amount', () => {
  const sample = row('completed');
  sample.order.orderNumber = '9663';
  sample.order.clientOrderId = '263026933';
  sample.order.totalAmount = 16.61;
  sample.order.discountAmount = 3;
  sample.order.taxAmount = 1.64;
  sample.storeOrder.total = 16.61;
  sample.storeOrder.discountTotal = 3;
  sample.storeOrder.taxTotal = 1.64;
  sample.storeOrder.couponLines = [{ code: '2025' }];
  sample.storeOrder.feeLines = [{ name: 'coupon_discount', total: '-3.00', tax_status: 'none' }];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '1.64' }];
  sample.storeOrder.lineItems = [{
    name: 'Items', quantity: 1, subtotal: '20.97', total: '17.97',
    subtotal_tax: '1.91', total_tax: '1.64',
    taxes: [{ id: 9.1, subtotal: '1.91', total: '1.64' }],
  }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '1.64');
  assert.equal(order.total, '19.61');
  assert.equal(order.net_payment, 19.61);
});

test('total-orders uses the actual coupon amount for order 263028812', () => {
  const sample = row('completed');
  sample.order.orderNumber = '7643';
  sample.order.clientOrderId = '263028812';
  sample.order.totalAmount = 77.06;
  sample.order.discountAmount = 8.83;
  sample.order.taxAmount = 6.43;
  sample.storeOrder.total = 77.06;
  sample.storeOrder.discountTotal = 8.83;
  sample.storeOrder.taxTotal = 6.43;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [
    { name: 'merchant_discount', total: '-8.83', tax_status: 'none' },
    { name: 'coupon_discount', total: '-8.83', tax_status: 'none' },
  ];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '6.43' }];
  sample.storeOrder.lineItems = [{
    name: 'Items', quantity: 1, subtotal: '88.29', total: '88.29',
    subtotal_tax: '7.23', total_tax: '7.23',
    taxes: [{ id: 9.1, subtotal: '7.23', total: '7.23' }],
  }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '6.78');
  assert.equal(order.total, '81.24');
  assert.equal(order.net_payment, 81.24);
  assert.equal(order.fee_lines[1].total, '-5.00');
});

test('total-orders does not deduct a represented merchant discount twice for Woo order 4134', () => {
  const sample = row('completed');
  sample.order.orderNumber = '4134';
  sample.order.clientOrderId = '263020684';
  sample.order.totalAmount = 67.95;
  sample.order.discountAmount = 10.49;
  sample.order.taxAmount = 4;
  sample.storeOrder.total = 67.95;
  sample.storeOrder.discountTotal = 10.49;
  sample.storeOrder.taxTotal = 4;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [
    { name: 'merchant_discount', total: '-5.49', tax_status: 'none' },
    { name: 'coupon_discount', total: '-5.49', tax_status: 'none' },
    { name: 'Payout', total: '-10.00', tax_status: 'none' },
    { name: 'Cashback Fee', total: '10.00', tax_status: 'none' },
  ];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '4.00' }];
  sample.storeOrder.lineItems = [
    ['2.99', '0.24'], ['3.99', '0.32'], ['3.99', '0.32'],
    ['26.97', '2.21'], ['16.99', '1.40'],
  ].map(([total, tax]) => ({
    name: 'Item', quantity: 1, subtotal: total, total,
    subtotal_tax: tax, total_tax: tax,
    taxes: [{ id: 9.1, subtotal: tax, total: tax }],
  }));
  sample.storeOrder.lineItems.push({
    name: 'Cashback', quantity: 1, subtotal: '20.00', total: '20.00',
    tax_status: 'none', subtotal_tax: '0.00', total_tax: '0.00', taxes: [],
    meta_data: [{ key: '_pos_line_type', value: 'cashback' }],
  });
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.woo_order_id, 4134);
  assert.equal(order.total_tax, '4.04');
  assert.equal(order.total, '68.48');
  assert.equal(order.net_payment, 68.48);
  assert.equal(order.fee_lines[1].total, '-5.00');
});

test('total-orders corrects stored discount tax for order 263025690', () => {
  const sample = row('completed');
  sample.order.clientOrderId = '263025690';
  sample.order.totalAmount = 22.67;
  sample.order.discountAmount = 13.70;
  sample.order.taxAmount = 3.03;
  sample.storeOrder.total = 22.67;
  sample.storeOrder.discountTotal = 13.70;
  sample.storeOrder.taxTotal = 3.03;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [
    { name: 'merchant_discount', total: '-3.70', tax_status: 'none' },
    { name: 'coupon_discount', total: '-13.70', tax_status: 'none' },
  ];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '3.03' }];
  sample.storeOrder.lineItems = [{
    name: 'Items', quantity: 6, subtotal: '37.04', total: '37.04',
    subtotal_tax: '3.03', total_tax: '3.03',
    taxes: [{ id: 9.1, subtotal: '3.03', total: '3.03' }],
  }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '2.58');
  assert.equal(order.total, '30.92');
  assert.equal(order.net_payment, 30.92);
  assert.equal(order.fee_lines[1].total, '-5.00');
});

test('total-orders uses coupon_lines for order 263022351', () => {
  const sample = row('completed');
  sample.order.clientOrderId = '263022351';
  sample.order.totalAmount = 116.28;
  sample.order.discountAmount = 26.38;
  sample.order.taxAmount = 10.80;
  sample.storeOrder.total = 116.28;
  sample.storeOrder.discountTotal = 26.38;
  sample.storeOrder.taxTotal = 10.80;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [
    { name: 'merchant_discount', total: '-13.19', tax_status: 'none' },
    { name: 'coupon_discount', total: '-13.19', tax_status: 'none' },
  ];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '10.80' }];
  sample.storeOrder.lineItems = [{
    name: 'Items', quantity: 14, subtotal: '131.86', total: '131.86',
    subtotal_tax: '10.80', total_tax: '10.80',
    taxes: [{ id: 9.1, subtotal: '10.80', total: '10.80' }],
  }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '10.34');
  assert.equal(order.total, '124.01');
  assert.equal(order.net_payment, 124.01);
  assert.equal(order.fee_lines[1].total, '-5.00');
});

test('total-orders returns the stored order total', () => {
  const sample = row('completed');
  sample.order.totalAmount = 183.81;
  sample.order.taxAmount = 15;
  sample.order.discountAmount = 6;
  sample.storeOrder.total = 179.83;
  sample.storeOrder.grandTotal = 196.81;
  sample.storeOrder.taxTotal = 15;
  sample.storeOrder.discountTotal = 6;
  sample.storeOrder.couponLines = [{ code: '2027', discount: '6.00' }];
  sample.storeOrder.lineItems = [{ name: 'Cheetos mix', quantity: 19, subtotal: '189.81', total: '183.81' }];
  sample.storeOrder.feeLines = [{ name: 'merchant_discount', total: '-18.98' }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total, '179.83');
  assert.equal(order.grand_total, undefined);
  assert.equal(order.total_tax, '15');
});

test('total-orders marks only partially refunded lines and reports refund totals', () => {
  const result = new OrderListPresenter().present(1, 10, 1, [row('partial-refund')]);
  const order = result.orders_data[0];
  assert.equal(order.line_items[0].is_refund_item, true);
  assert.equal(order.line_items[1].is_refund_item, false);
  assert.equal(order.refund_total, 15.98);
  assert.equal(order.net_payment, 47.82);
});

test('total-orders uses the repository effective refund status', () => {
  const partial = row('completed');
  partial.effectiveStatus = 'partial-refund';
  const refunded = row('completed');
  refunded.effectiveStatus = 'refunded';
  const result = new OrderListPresenter().present(1, 10, 2, [partial, refunded]);
  assert.equal(result.orders_data[0].status, 'Partially Refunded');
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
