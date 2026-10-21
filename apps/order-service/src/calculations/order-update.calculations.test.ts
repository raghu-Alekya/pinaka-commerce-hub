import assert from 'node:assert/strict';
import test from 'node:test';
import {
  merchantDiscountCoverage,
  selectMinimumEligibleCoupon,
  type CouponSpec,
  type OrderLine,
} from './order-update.calculations';

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

test('the smallest eligible coupon is selected for the remaining balance', () => {
  const chosen = selectMinimumEligibleCoupon([ten, five], 4);
  assert.equal(chosen?.code, 'SAVE5');
  assert.equal(chosen?.amount, 5);
});
