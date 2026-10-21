import assert from 'node:assert/strict';
import test from 'node:test';
import {
  merchantDiscountCoverage,
  selectMinimumEligibleCoupon,
  type CouponSpec,
  type OrderLine,
} from './order-update.calculations';
import { calculateOrderTotal, totalExcludingTax } from './store-order.calculations';

const five: CouponSpec = { code: 'SAVE5', discountType: 'fixed_cart', amount: 5 };
const ten: CouponSpec = { code: 'SAVE10', discountType: 'fixed_cart', amount: 10 };

function line(subtotal: string, total: string): OrderLine {
  return { name: 'Item', product_id: '1', quantity: 1, subtotal, total };
}

test('merchant discount that consumes the merchandise subtotal blocks a coupon', () => {
  const coverage = merchantDiscountCoverage(
    [line('10.00', '0.00')],
    [{ code: 'pos-discount', discount: '10.00' }],
  );
  assert.equal(coverage.coversOrder, true);
  assert.equal(coverage.remaining, 0);
});

test('a partial merchant discount leaves the unpaid balance', () => {
  const coverage = merchantDiscountCoverage(
    [line('10.00', '4.00')],
    [{ code: 'pos-discount', discount: '6.00' }],
  );
  assert.equal(coverage.coversOrder, false);
  assert.equal(coverage.merchantDiscount, 6);
  assert.equal(coverage.remaining, 4);
});

test('order total does not include tax', () => {
  const totals = calculateOrderTotal({
    lineItems: [{ name: 'Item', subtotal: '10.00', total: '10.00' }],
    feeLines: [{ name: 'Bag', total: '0.10' }],
    taxLines: [{ tax_total: '0.82', shipping_tax_total: '0' }],
    shippingTotal: 1,
  });
  assert.equal(totals.taxTotal, 0.82);
  assert.equal(totals.total, 11.1);
});

test('stored totals that already exclude tax are left unchanged', () => {
  assert.equal(totalExcludingTax({
    total: 11.1,
    tax: 0.82,
    lineItems: [{ name: 'Item', total: '10.00' }],
    feeLines: [{ name: 'Bag', total: '0.10' }],
    shippingTotal: 1,
  }), 11.1);
});

test('stored totals that include tax drop total_tax', () => {
  assert.equal(totalExcludingTax({
    total: 11.92,
    tax: 0.82,
    lineItems: [{ name: 'Item', total: '10.00' }],
    feeLines: [{ name: 'Bag', total: '0.10' }],
    shippingTotal: 1,
  }), 11.1);
});

test('the smallest eligible coupon is selected for the remaining balance', () => {
  const chosen = selectMinimumEligibleCoupon([ten, five], 4);
  assert.equal(chosen?.code, 'SAVE5');
  assert.equal(chosen?.amount, 5);
});
