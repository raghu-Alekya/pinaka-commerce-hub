import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderListPresenter } from './order-list.presenter';
import { OrderResponsePresenter } from './order-response.presenter';
import { OrderUpdatePresenter } from '../modules/order-updates/order-update.presenter';

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

test('total-orders and order details tax the discounted taxable item only', () => {
  const lines = [
    {
      id: 'ITEM-1', name: 'Lucas Gummies Spicy Watermelon', product_id: 81185, quantity: 1,
      subtotal: '4.00', total: '4.00', subtotal_tax: '0.32', total_tax: '0.32', tax_class: '',
      taxes: [{ id: 9.1, total: '0.32', subtotal: '0.32' }],
    },
    {
      id: 'ITEM-2', name: 'Vitacoco Pressed Coconut 16 9', product_id: 79361, quantity: 1,
      subtotal: '2.99', total: '2.99', subtotal_tax: '0.00', total_tax: '0.00', tax_class: 'zero',
      taxes: [],
    },
  ];
  const fees = [{ name: 'merchant_discount', total: '-0.70', tax_status: 'none' }];
  const taxLines = [{ id: 1, rate_code: 'POS-TAX-1', rate_id: 1, label: 'Tax', compound: false, tax_total: '0.32', shipping_tax_total: '0.00', rate_percent: 9.1, meta_data: [] }];
  const listed = row('pending');
  listed.order.clientOrderId = '263151655';
  listed.order.orderNumber = '5508';
  listed.order.totalAmount = 6.61;
  listed.order.discountAmount = 0.7;
  listed.order.taxAmount = 0.32;
  listed.order.paymentStatus = 'PENDING';
  listed.storeOrder.total = 6.61;
  listed.storeOrder.discountTotal = 0.7;
  listed.storeOrder.taxTotal = 0.32;
  listed.storeOrder.lineItems = lines;
  listed.storeOrder.feeLines = fees;
  listed.storeOrder.taxLines = taxLines;
  listed.storeOrder.couponLines = [];
  listed.refunds = [];
  const listOrder = new OrderListPresenter().present(1, 10, 1, [listed]).orders_data[0];
  const detail = new OrderUpdatePresenter(new OrderResponsePresenter()).present({
    order: {
      ...listed.order,
      id: '767fafa9-eec3-421a-9c54-f8b7e3739ef7',
      createdAt: listed.order.createdAt,
      updatedAt: listed.order.updatedAt,
      requestPayload: { created_via: 'rest-api', currency: 'USD', prices_include_tax: false },
      metadata: [],
    },
    items: lines.map((line) => ({
      id: line.id,
      productName: line.name,
      productId: String(line.product_id),
      quantity: line.quantity,
      totalPrice: Number(line.total),
      unitPrice: Number(line.total),
      modifiers: [],
    })),
    storeOrder: {
      ...listed.storeOrder,
      currency: 'USD',
      timezone: 'UTC',
      grandTotal: 6.61,
      metadata: [],
    },
  } as never) as { total_tax: string; cart_tax: string; total: string; line_items: Array<{ total_tax: string; tax_class: string }> };
  assert.equal(listOrder.total_tax, '0.32');
  assert.equal(listOrder.line_items[0].total_tax, '0.32');
  assert.equal(listOrder.line_items[1].total_tax, '0.00');
  assert.equal(listOrder.total, '6.61');
  assert.equal(detail.total_tax, '0.32');
  assert.equal(detail.cart_tax, '0.32');
  assert.equal(detail.line_items[0].total_tax, '0.32');
  assert.equal(detail.line_items[1].total_tax, '0.00');
  assert.equal(detail.line_items[1].tax_class, 'zero');
  assert.equal(detail.total, '6.61');
});

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
  assert.equal(order.total_tax, '4.49');
  assert.equal(order.total, '53.98');
  assert.equal(order.net_payment, 53.98);
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
  assert.equal(order.total_tax, '2.27');
  assert.equal(order.total, '27.43');
  assert.equal(order.net_payment, 27.43);
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
  assert.equal(order.total_tax, '4.55');
  assert.equal(order.total, '44.50');
  assert.equal(order.net_payment, 44.5);
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
  assert.equal(order.total, '16.61');
  assert.equal(order.net_payment, 16.61);
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
  assert.equal(order.total_tax, '6.43');
  assert.equal(order.total, '77.06');
  assert.equal(order.net_payment, 77.06);
  assert.equal(order.fee_lines[1].total, '-5.00');
});

test('total-orders does not apply an already represented coupon twice for order 263029799', () => {
  const sample = row('completed');
  sample.order.orderNumber = '3183';
  sample.order.clientOrderId = '263029799';
  sample.order.totalAmount = 22.78;
  sample.order.discountAmount = 7.88;
  sample.order.taxAmount = 1.90;
  sample.storeOrder.total = 22.78;
  sample.storeOrder.discountTotal = 7.88;
  sample.storeOrder.taxTotal = 1.90;
  sample.storeOrder.couponLines = [{ code: '2025', discount: '5.00' }];
  sample.storeOrder.feeLines = [
    { name: 'merchant_discount', total: '-2.88', tax_status: 'none' },
    { name: 'coupon_discount', total: '-5.00', tax_status: 'none' },
  ];
  sample.storeOrder.taxLines = [{ rate_percent: 9.1, tax_total: '1.90' }];
  sample.storeOrder.lineItems = [
    { name: 'Item 1', quantity: 2, subtotal: '14.38', total: '10.44', subtotal_tax: '1.31', total_tax: '0.95', taxes: [{ id: 9.1, subtotal: '1.31', total: '0.95' }] },
    { name: 'Item 2', quantity: 2, subtotal: '14.38', total: '10.44', subtotal_tax: '1.31', total_tax: '0.95', taxes: [{ id: 9.1, subtotal: '1.31', total: '0.95' }] },
  ];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  assert.equal(order.total_tax, '1.9');
  assert.equal(order.total, '22.78');
  assert.equal(order.net_payment, 22.78);
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
  assert.equal(order.total_tax, '4');
  assert.equal(order.total, '67.95');
  assert.equal(order.net_payment, 67.95);
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
  assert.equal(order.total_tax, '3.03');
  assert.equal(order.total, '22.67');
  assert.equal(order.net_payment, 22.67);
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
  assert.equal(order.total_tax, '10.8');
  assert.equal(order.total, '116.28');
  assert.equal(order.net_payment, 116.28);
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

test('total-orders keeps the stored order tax after a partial refund', () => {
  const partial = row('partial-refund');
  partial.order.taxAmount = 1.63;
  partial.storeOrder.taxTotal = 1.63;
  partial.storeOrder.lineItems = [
    { id: 'ITEM-8c0ca90d-4af1-4489-b962-7c73d225e1aa-1', name: 'Coors Light', quantity: 1, total: '15.98', total_tax: '1.46' },
    { id: 'ITEM-8c0ca90d-4af1-4489-b962-7c73d225e1aa-2', name: 'Bigsip 4', quantity: 1, total: '3.99', total_tax: '0.17' },
  ];
  const completed = row('completed');
  completed.order.taxAmount = 1.63;
  completed.storeOrder.taxTotal = 1.63;
  completed.refunds = [];
  const refunded = row('refunded');
  refunded.order.taxAmount = 1.63;
  refunded.storeOrder.taxTotal = 1.63;
  const result = new OrderListPresenter().present(1, 10, 3, [partial, completed, refunded]);
  assert.equal(result.orders_data[0].total_tax, '1.63');
  assert.equal(result.orders_data[1].total_tax, '1.63');
  assert.equal(result.orders_data[2].total_tax, '1.63');
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

test('total-orders adds the loyalty discount fee without changing the total', () => {
  const sample = row('completed');
  sample.order.totalAmount = 100;
  sample.order.taxAmount = 8;
  sample.order.metadata = [{ key: 'redeemed_value', value: 10 }];
  sample.storeOrder.total = 108;
  sample.storeOrder.taxTotal = 8;
  sample.storeOrder.taxLines = [{ rate_percent: 8, tax_total: '8.00' }];
  sample.storeOrder.feeLines = [];
  sample.storeOrder.lineItems = [{ name: 'Product A', quantity: 1, subtotal: '100.00', total: '100.00' }];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  const loyalty = order.fee_lines.find((fee: { name?: string }) => fee.name === 'loyalty_discount');
  assert.equal(order.line_items.length, 1);
  assert.equal(loyalty.total, '-10.00');
  assert.equal(loyalty.tax_status, 'none');
  assert.equal(order.total, '108.00');
});

test('total-orders does not add a second loyalty fee or reduce the total again', () => {
  const sample = row('completed');
  sample.order.totalAmount = 90;
  sample.order.taxAmount = 0;
  sample.order.metadata = [{ key: 'redeem_amount', value: 10 }];
  sample.storeOrder.total = 90;
  sample.storeOrder.taxTotal = 0;
  sample.storeOrder.taxLines = [];
  sample.storeOrder.feeLines = [{ name: 'loyalty_discount', total: '-10.00', tax_status: 'none' }];
  sample.storeOrder.lineItems = [
    { name: 'Product A', quantity: 1, subtotal: '100.00', total: '100.00' },
  ];
  sample.refunds = [];
  const order = new OrderListPresenter().present(1, 10, 1, [sample]).orders_data[0];
  const loyalty = order.fee_lines.filter((fee: { name?: string }) => fee.name === 'loyalty_discount');
  assert.equal(loyalty.length, 1);
  assert.equal(order.total, '90.00');
});
