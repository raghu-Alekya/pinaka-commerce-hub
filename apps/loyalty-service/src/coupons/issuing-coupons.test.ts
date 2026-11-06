import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CouponsController } from './coupons.controller';
import {
  cartTargets,
  orderTotalFromLineItems,
  periodStart,
  selectIssuingCoupons,
  type CatalogProduct,
  type IssuedCouponOrder,
  type IssuingCoupon,
} from './issuing-coupons';

const now = new Date(2026, 9, 31, 15, 30, 0);
const storeId = '11111111-1111-1111-1111-111111111111';

function coupon(overrides: Partial<IssuingCoupon> = {}): IssuingCoupon {
  return {
    id: '120',
    storeId,
    code: 'welcome10',
    discountType: 'percent',
    amount: 10,
    minAmount: 25,
    maxAmount: null,
    generateType: 'daily',
    generateLimit: 5,
    expiryDate: '2026-12-31',
    enabled: true,
    usageLimit: null,
    usageCount: 0,
    productIds: [],
    excludedProductIds: [],
    categoryIds: [],
    excludedCategoryIds: [],
    ...overrides,
  };
}

function product(id: number, categoryIds: number[], overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return { id, storeId, parentId: null, type: 'simple', categoryIds, ...overrides };
}

function issue(orderId: string, completedAt: Date, overrides: Partial<IssuedCouponOrder> = {}): IssuedCouponOrder {
  return { couponId: '120', storeId, orderId, orderStatus: 'completed', completedAt, ...overrides };
}

function select(overrides: Partial<IssuingCoupon> = {}, extra: {
  lineItems?: unknown[];
  products?: CatalogProduct[];
  issuances?: IssuedCouponOrder[];
  orderTotal?: number;
} = {}) {
  const lineItems = extra.lineItems ?? [{ product_id: 10, quantity: 1, subtotal: 45 }];
  return selectIssuingCoupons({
    lineItems,
    orderTotal: extra.orderTotal ?? orderTotalFromLineItems(lineItems),
    coupons: [coupon(overrides)],
    products: extra.products ?? [product(10, [2])],
    issuances: extra.issuances ?? [],
    now,
  });
}

test('order total is the rounded sum of line subtotals', () => {
  assert.equal(orderTotalFromLineItems([
    { product_id: 1, quantity: 2, subtotal: '20.10' },
    { product_id: 2, quantity: 1, subtotal: 24.895 },
  ]), 45);
  assert.equal(orderTotalFromLineItems([]), 0);
});

test('an enabled issuing coupon is returned with unset limits as null', () => {
  assert.deepEqual(select({ minAmount: 25, maxAmount: null, generateType: 'daily', generateLimit: 5 }), [{
    id: '120',
    code: 'welcome10',
    discount_type: 'percent',
    amount: 10,
    min_amount: 25,
    max_amount: null,
    generate_type: 'daily',
    generate_limit: 5,
    expiry_date: '2026-12-31',
  }]);
});

test('disabled, expired, under-minimum, over-maximum, and used-up coupons are skipped', () => {
  assert.deepEqual(select({ enabled: false }), []);
  assert.deepEqual(select({ expiryDate: '2026-10-30' }), []);
  assert.deepEqual(select({ expiryDate: '2026-10-31' }).map((row) => row.id), ['120']);
  assert.deepEqual(select({ expiryDate: null }).map((row) => row.expiry_date), [null]);
  assert.equal(select({ minAmount: 45 })[0]?.min_amount, 45);
  assert.deepEqual(select({ minAmount: 45.01 }), []);
  assert.deepEqual(select({ maxAmount: 45 }).map((row) => row.max_amount), [45]);
  assert.deepEqual(select({ maxAmount: 44.99 }), []);
  assert.deepEqual(select({ usageLimit: 2, usageCount: 2 }), []);
  assert.deepEqual(select({ usageLimit: null, usageCount: 9 }).map((row) => row.id), ['120']);
});

test('product and category restrictions all have to pass', () => {
  const lines = [
    { product_id: 10, quantity: 1, subtotal: 20 },
    { product_id: 11, variation_id: 55, quantity: 1, subtotal: 25 },
  ];
  const products = [
    product(10, [2]),
    product(11, [2], { type: 'variable' }),
    product(55, [9], { parentId: 11, type: 'variation' }),
  ];
  const passed = select({ productIds: [55], categoryIds: [2] }, { lineItems: lines, products });
  assert.equal(passed.length, 1);
  assert.deepEqual(select({ productIds: [11] }, { lineItems: lines, products }), []);
  assert.deepEqual(select({ productIds: [55], excludedProductIds: [10] }, { lineItems: lines, products }), []);
  assert.deepEqual(select({ categoryIds: [2] }, { lineItems: lines, products }).length, 1);
  assert.deepEqual(select({ categoryIds: [9] }, { lineItems: lines, products }), []);
  assert.deepEqual(select({ categoryIds: [2], excludedCategoryIds: [2] }, { lineItems: lines, products }), []);
  assert.deepEqual(cartTargets(lines, products), { productIds: [10, 55], categoryIds: [2] });
});

test('a simple product uses its own direct categories', () => {
  const lines = [{ product_id: 10, quantity: 1, subtotal: 45 }];
  const products = [product(10, [4])];
  assert.deepEqual(cartTargets(lines, products), { productIds: [10], categoryIds: [4] });
  assert.equal(select({ categoryIds: [4] }, { lineItems: lines, products }).length, 1);
  assert.deepEqual(select({ categoryIds: [99] }, { lineItems: lines, products }), []);
});

test('generate limits count completed issuances in the current period only', () => {
  const today = new Date(2026, 9, 31, 9, 0, 0);
  const yesterday = new Date(2026, 9, 30, 12, 0, 0);
  assert.deepEqual(select({ generateType: 'daily', generateLimit: 1 }, {
    issuances: [issue('order-1', today)],
  }), []);
  assert.equal(select({ generateType: 'daily', generateLimit: 1 }, {
    issuances: [issue('order-1', yesterday)],
  }).length, 1);
  assert.equal(select({ generateType: 'daily', generateLimit: 1 }, {
    issuances: [issue('order-1', today, { orderStatus: 'processing' })],
  }).length, 1);
  assert.equal(select({ generateType: 'daily', generateLimit: 2 }, {
    issuances: [issue('order-1', today), issue('order-1', today)],
  }).length, 1);
  assert.equal(select({ generateType: null, generateLimit: null }, {
    issuances: [issue('order-1', today)],
  }).length, 1);
  assert.equal(periodStart('weekly', now)?.getDate(), 26);
  assert.equal(periodStart('monthly', now)?.getMonth(), 9);
  assert.equal(periodStart('yearly', now)?.getMonth(), 0);
  assert.equal(periodStart('yearly', now)?.getDate(), 1);
});

test('the route rejects an empty cart and returns the coupons that pass', async () => {
  const controller = new CouponsController({
    findApplicable: async () => [select()[0]],
  } as any);
  await assert.rejects(() => controller.issuingCoupons({ line_items: [] }), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    return true;
  });
  await assert.rejects(
    () => controller.issuingCoupons({ line_items: [{ product_id: 10, quantity: 1, subtotal: 0 }] }),
    (error: unknown) => error instanceof BadRequestException,
  );
  const response = await controller.issuingCoupons({
    line_items: [{ product_id: 10, quantity: 1, subtotal: 20 }, { product_id: 11, quantity: 1, subtotal: 25 }],
  });
  assert.equal(response.order_total, 45);
  assert.equal(response.coupons[0]?.code, 'welcome10');
});
