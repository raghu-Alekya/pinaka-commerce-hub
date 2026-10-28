import assert from 'node:assert/strict';
import test from 'node:test';
import {
  merchantDiscountCoverage,
  selectMinimumEligibleCoupon,
  type CouponSpec,
  type OrderLine,
} from './order-update.calculations';
import { cashChangeReturned } from './order-change';
import {
  allocateRoundedTax,
  applyMerchantDiscountToStoredTax,
  calculateOrderTotal,
  calculateTaxLines,
  orderTotalWithTax,
  listOrderTotal,
  taxUnitsForMinor,
  totalExcludingTax,
  totalIncludingTax,
} from './store-order.calculations';

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

test('a payout line stays negative and is excluded from tax', () => {
  const payout = {
    name: 'Payout',
    total: '-10.00',
    subtotal: '-10.00',
    tax_status: 'none',
    meta_data: [{ key: '_pos_item_type', value: 'payout' }],
  };
  const product = { name: 'Cheetos mix', total: '20.00', subtotal: '20.00' };
  assert.equal(calculateOrderTotal({ lineItems: [product] }).total, 20);
  assert.equal(calculateOrderTotal({ lineItems: [payout] }).total, -10);
  assert.equal(calculateOrderTotal({ lineItems: [product, payout] }).total, 10);
  assert.equal(calculateTaxLines({ lineItems: [product, payout], rate: 10 }).at(0)?.tax_total, '2.00');
  assert.equal(calculateTaxLines({ lineItems: [payout], rate: 10 }).length, 0);
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

test('order list total is the net after merchant discount plus tax', () => {
  const lines = [{ name: 'Cheetos mix', subtotal: '189.81', total: '183.81' }];
  const fees = [{ name: 'merchant_discount', total: '-18.98' }];
  assert.equal(listOrderTotal({
    total: 183.81,
    tax: 15,
    couponDiscount: 6,
    lineItems: lines,
    feeLines: fees,
  }), 179.83);
  assert.equal(listOrderTotal({
    total: 164.83,
    tax: 15,
    couponDiscount: 6,
    lineItems: lines,
    feeLines: fees,
  }), 179.83);
});

test('cash change is the tender above the order total', () => {
  assert.deepEqual(cashChangeReturned({
    orderTotal: 174.54,
    payments: [{ method: 'Cash', amount: 200, status: 'completed' }],
  }), { change: 25.46, cashReceived: 200 });
  assert.deepEqual(cashChangeReturned({
    orderTotal: 174.54,
    payments: [
      { method: 'Cash', amount: 100, status: 'completed' },
      { method: 'Card', amount: 100, status: 'completed' },
    ],
  }), { change: 25.46, cashReceived: 100 });
  assert.deepEqual(cashChangeReturned({
    orderTotal: 50,
    payments: [{ method: 'Card', amount: 60, status: 'completed' }],
  }), { change: 0, cashReceived: 0 });
  assert.deepEqual(cashChangeReturned({
    orderTotal: 174.54,
    cashPaid: '200.00',
    payments: [{ method: 'cash', amount: 174.54, status: 'completed' }],
  }), { change: 25.46, cashReceived: 200 });
  assert.deepEqual(cashChangeReturned({
    orderTotal: -10,
    payments: [{ method: 'Cash', amount: 0, status: 'completed' }],
    cashPaid: '-10.00',
  }), { change: 0, cashReceived: 0 });
});

test('stored order total includes tax and keeps a payout negative', () => {
  assert.equal(orderTotalWithTax({ netBeforeTax: 174.54, tax: 12.22 }), 186.76);
  assert.equal(orderTotalWithTax({ netBeforeTax: 20, tax: 2 }), 22);
  assert.equal(orderTotalWithTax({ netBeforeTax: -10, tax: 0 }), -10);
  assert.equal(orderTotalWithTax({ netBeforeTax: 22, tax: 2, pricesIncludeTax: true }), 22);
});

test('order list adds tax when the stored total excludes it', () => {
  assert.equal(totalIncludingTax({
    total: 11.1,
    tax: 0.82,
    lineItems: [{ name: 'Item', total: '10.00' }],
    feeLines: [{ name: 'Bag', total: '0.10' }],
    shippingTotal: 1,
  }), 11.92);
});

test('order list keeps a stored total that already includes tax', () => {
  assert.equal(totalIncludingTax({
    total: 11.92,
    tax: 0.82,
    lineItems: [{ name: 'Item', total: '10.00' }],
    feeLines: [{ name: 'Bag', total: '0.10' }],
    shippingTotal: 1,
  }), 11.92);
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

test('tax is calculated after a merchant_discount fee', () => {
  const before = calculateTaxLines({
    lineItems: [
      { name: 'Tama Tarrro', total: '9.98' },
      { name: 'Cosbytoys', total: '13.98' },
      { name: 'Cashback', total: '50.00' },
    ],
    rate: 7.22,
    decimalPlaces: 2,
  });
  const after = calculateTaxLines({
    lineItems: [
      { name: 'Tama Tarrro', total: '9.98' },
      { name: 'Cosbytoys', total: '13.98' },
      { name: 'Cashback', total: '50.00' },
    ],
    feeLines: [{ name: 'merchant_discount', total: '-11.98' }],
    rate: 7.22,
    decimalPlaces: 2,
  });
  assert.equal(before[0].tax_total, '1.73');
  assert.equal(after[0].tax_total, '0.86');
});

test('a payout is excluded from tax and does not reduce the merchandise base', () => {
  const lineItems = [
    { name: 'Tama Tarrro', total: '9.98' },
    { name: 'Cosbytoys', total: '13.98' },
    {
      name: 'Cashback',
      total: '10.00',
      tax_status: 'none',
      meta_data: [{ key: '_pos_line_type', value: 'cashback' }],
    },
  ];
  const feeLines = [
    { name: 'Payout', tax_status: 'none', total: '-10.00' },
    { name: 'Cashback Fee', tax_status: 'none', total: '10.00' },
    { name: 'merchant_discount', total: '-2.40', tax_status: 'none' },
  ];
  const exclusive = calculateTaxLines({ lineItems, feeLines, rate: 10, decimalPlaces: 2 });
  const inclusive = calculateTaxLines({
    lineItems,
    feeLines,
    rate: 10,
    pricesIncludeTax: true,
    decimalPlaces: 2,
  });
  const withoutPayout = calculateTaxLines({
    lineItems,
    feeLines: feeLines.filter((fee) => fee.name !== 'Payout'),
    rate: 10,
    decimalPlaces: 2,
  });
  assert.equal(exclusive[0].tax_total, '2.16');
  assert.equal(withoutPayout[0].tax_total, '2.16');
  assert.equal(inclusive[0].tax_total, '1.96');
});

test('stored tax is scaled to the total after merchant_discount', () => {
  const lines = [
    { name: 'Tama Tarrro', total: '9.98', total_tax: '0.72', subtotal_tax: '0.72', taxes: [{ total: '0.72', subtotal: '0.72' }] },
    { name: 'Cosbytoys', total: '13.98', total_tax: '1.01', subtotal_tax: '1.01', taxes: [{ total: '1.01', subtotal: '1.01' }] },
    { name: 'Cashback', total: '50.00', total_tax: '0.00', subtotal_tax: '0.00' },
  ];
  const order = {
    total_tax: '1.73',
    cart_tax: '1.73',
    tax_lines: [{ tax_total: '1.73' }],
  };
  applyMerchantDiscountToStoredTax(lines, [{ name: 'merchant_discount', total: '-11.98' }], order);
  assert.equal(lines[0].total_tax, '0.36');
  assert.equal(lines[1].total_tax, '0.51');
  assert.equal(lines[2].total_tax, '0.00');
  assert.equal(order.total_tax, '0.87');
  assert.equal(order.cart_tax, '0.87');
  assert.equal(order.tax_lines[0].tax_total, '0.87');
});

test('discounted lines at 9.10 percent round tax once to 2.64', () => {
  const taxableMinor = [1699, 299, 689, 219];
  const allocated = allocateRoundedTax(taxableMinor.map((amount) => taxUnitsForMinor(amount, 9.1)));
  const taxMinor = allocated.reduce((sum, amount) => sum + amount, 0);
  assert.equal(taxableMinor.reduce((sum, amount) => sum + amount, 0), 2906);
  assert.equal(taxMinor, 264);
  assert.equal(orderTotalWithTax({ netBeforeTax: 29.06, tax: 2.64 }), 31.7);
  assert.deepEqual(allocateRoundedTax([taxUnitsForMinor(1699, 9.1)]), [155]);
  const tenPercent = allocateRoundedTax([
    taxUnitsForMinor(1000, 10),
    taxUnitsForMinor(1000, 10),
  ]);
  assert.equal(tenPercent.reduce((sum, amount) => sum + amount, 0), 200);
});

test('the smallest eligible coupon is selected for the remaining balance', () => {
  const chosen = selectMinimumEligibleCoupon([ten, five], 4);
  assert.equal(chosen?.code, 'SAVE5');
  assert.equal(chosen?.amount, 5);
});
