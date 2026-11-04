import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableFromLedger,
  flattenCatalog,
  liveRedemption,
  loyaltyUsername,
  earnedOrderPoints,
  orderEarnsLoyalty,
  orderIsCompleted,
  partialRefundExpiredPoints,
  paymentIsVoid,
  presentSettings,
  redemptionBlocked,
  settingsFromStored,
  shouldClearLedgerAfterVoid,
  taggedItemPoints,
  validateSettingsUpdate,
  welcomePoints,
} from './loyalty.rules';

const settingsBody = {
  pinaka_loyalty_ratio_dollar: 10,
  pinaka_loyalty_ratio_point: 1,
  pinaka_new_customer_points: 0,
  pinaka_loyalty_expiry_days: 365,
  pinaka_loyalty_min_spend: 0,
  pinaka_loyalty_max_spend: 1000,
  pinaka_loyalty_redeem_point: 100,
  pinaka_loyalty_redeem_amt: 10,
  pinaka_loyalty_min_points: 0,
  pinaka_loyalty_max_points: 10000,
  pinaka_loyalty_redeem_perc: 0,
  pinaka_loyalty_conflict_rule: 'disable',
};

test('settings accept zero integers and reject ranges and percentages', () => {
  const valid = validateSettingsUpdate(settingsBody);
  assert.ok('settings' in valid);
  if ('settings' in valid) {
    assert.deepEqual(presentSettings(valid.settings), {
      ratio_dollar: 10,
      ratio_point: 1,
      new_customer_points: 0,
      default_points: 0,
      loyalty_tag: 'LoyaltyPoints',
      mode: 'order',
      redeem_point: 100,
      redeem_amt: 10,
      expiry_days: 365,
      conflict_rule: 'disable',
      min_spend: 0,
      max_spend: 1000,
      min_points: 0,
      max_points: 10000,
      redeem_perc: 0,
      allow_redemption: true,
    });
  }
  const percentage = validateSettingsUpdate({ ...settingsBody, pinaka_loyalty_redeem_perc: 101 });
  assert.equal('code' in percentage && percentage.code, 'invalid_percentage');
  const spend = validateSettingsUpdate({ ...settingsBody, pinaka_loyalty_min_spend: 20, pinaka_loyalty_max_spend: 10 });
  assert.equal('code' in spend && spend.code, 'invalid_spend_range');
  const missing = validateSettingsUpdate({ ...settingsBody, pinaka_loyalty_ratio_dollar: undefined });
  assert.equal('code' in missing && missing.code, 'missing_field');
});

test('live redemption uses the fixed block and skips the percentage formula', () => {
  assert.deepEqual(liveRedemption({
    orderTotal: 100, availablePoints: 100, redeemPoint: 10, redeemAmount: 10, ebtEligibleTotal: 0,
  }), {
    redeemPoints: 10, valueRedeemed: 10, newPayable: 90, message: 'Loyalty customer processed successfully.',
  });
  assert.equal(liveRedemption({
    orderTotal: 100, availablePoints: 4, redeemPoint: 10, redeemAmount: 10, ebtEligibleTotal: 0,
  }).redeemPoints, 0);
  assert.equal(liveRedemption({
    orderTotal: 5, availablePoints: 100, redeemPoint: 10, redeemAmount: 10, ebtEligibleTotal: 0,
  }).redeemPoints, 0);
  assert.equal(liveRedemption({
    orderTotal: 100, availablePoints: 100, redeemPoint: 10, redeemAmount: 10, ebtEligibleTotal: 3,
  }).redeemPoints, 0);
  assert.equal(liveRedemption({
    orderTotal: 100, availablePoints: 100, redeemPoint: 0, redeemAmount: 10, ebtEligibleTotal: 0,
  }).valueRedeemed, 0);
});

test('welcome points stay out of the spendable balance and include tagged item points', () => {
  const products = flattenCatalog([{
    id: 8,
    name: 'Tea',
    tags: [{ slug: 'loyaltypoints' }],
    meta_data: [{ key: '_product_loyalty_points', value: 4 }],
    variations: [{ id: 9, meta_data: [{ key: '_product_loyalty_points', value: '' }] }],
  }]);
  assert.equal(taggedItemPoints([{ product_id: 8, quantity: 2 }], products), 8);
  assert.equal(taggedItemPoints([{ product_id: 8, variation_id: 9, quantity: 3 }], products), 0);
  assert.equal(welcomePoints({
    availablePoints: 0, alreadyAdded: '', configuredPoints: 5, mode: 'item', itemPoints: 8,
  }), 13);
  assert.equal(welcomePoints({
    availablePoints: 0, alreadyAdded: 1, configuredPoints: 5, mode: 'order', itemPoints: 8,
  }), undefined);
});

test('customer usernames follow contact shape', () => {
  assert.equal(loyaltyUsername('Ada@Example.com', true), 'cust_ada');
  assert.equal(loyaltyUsername('(555) 010-1212', false), 'cust_5550101212');
});

test('conflict rule blocks coupons, discounts, and special products only when disabled', () => {
  assert.equal(redemptionBlocked({
    conflictRule: 'disable', discountTotal: 0, couponCount: 1, hasPayout: false, hasDiscountProduct: false, hasCashback: false,
  }), true);
  assert.equal(redemptionBlocked({
    conflictRule: 'enable', discountTotal: 5, couponCount: 1, hasPayout: true, hasDiscountProduct: true, hasCashback: true,
  }), false);
});

test('an order is completed from either status column', () => {
  assert.equal(orderIsCompleted('processing', 'COMPLETED'), true);
  assert.equal(orderIsCompleted('completed', 'CREATED'), true);
  assert.equal(orderIsCompleted('processing', 'CREATED'), false);
});

test('a paid order earns points before its status becomes completed', () => {
  assert.equal(orderEarnsLoyalty('processing', 'CREATED', 'PAID'), true);
  assert.equal(orderEarnsLoyalty('completed', 'COMPLETED', 'PAID'), true);
  assert.equal(orderEarnsLoyalty('cancelled', 'CANCELLED', 'PAID'), false);
  assert.equal(orderEarnsLoyalty('processing', 'CREATED', 'PENDING'), false);
});

test('completed orders earn floor of spend divided by the dollar ratio', () => {
  assert.equal(earnedOrderPoints(45.5, 10, 1), 4);
  assert.equal(earnedOrderPoints(9.99, 10, 1), 0);
  assert.equal(earnedOrderPoints(20, 0, 1), 0);
});

test('partial refund expiry follows item and order modes and caps at the balance', () => {
  assert.equal(partialRefundExpiredPoints({
    mode: 'item', creditedPoints: [12, 3], refundTotal: 40, ratioDollar: 10, ratioPoint: 1, availablePoints: 100,
  }), 15);
  assert.equal(partialRefundExpiredPoints({
    mode: 'order', creditedPoints: [], refundTotal: 25, ratioDollar: undefined, ratioPoint: undefined, availablePoints: 100,
  }), 2);
  assert.equal(partialRefundExpiredPoints({
    mode: 'order', creditedPoints: [], refundTotal: 80, ratioDollar: 10, ratioPoint: 1, availablePoints: 4,
  }), 4);
});

test('ledger balance ignores negative results and payment voids clear only unpaid orders', () => {
  assert.equal(availableFromLedger(100, 10, 5), 85);
  assert.equal(availableFromLedger(1, 5, 0), 0);
  assert.equal(shouldClearLedgerAfterVoid({ voided: true, amountPaid: 0, orderTotal: 90 }), true);
  assert.equal(shouldClearLedgerAfterVoid({ voided: true, amountPaid: 40, orderTotal: 90 }), true);
  assert.equal(shouldClearLedgerAfterVoid({ voided: true, amountPaid: 90, orderTotal: 90 }), false);
  assert.equal(shouldClearLedgerAfterVoid({ voided: false, amountPaid: 0, orderTotal: 90 }), false);
  assert.equal(paymentIsVoid({ metadata: { source_payload: { void: true } } }), true);
  assert.equal(settingsFromStored({}).mode, 'order');
  assert.equal(settingsFromStored({ pinaka_loyalty_mode: 'item' }).mode, 'item');
});
