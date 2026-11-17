export interface LoyaltyLine {
  name?: string;
  quantity?: number | string;
  subtotal?: number | string;
  total?: number | string;
  product_id?: number | string;
  productId?: number | string;
  meta_data?: Array<{ key?: string; value?: unknown }>;
}

export function isLoyaltyRedemptionLine(line: LoyaltyLine | null | undefined): boolean {
  const name = String(line?.name || '').trim().toLowerCase();
  if (name === 'loyalty') return true;
  const meta = Array.isArray(line?.meta_data) ? line.meta_data : [];
  return meta.some((entry) => entry?.key === '_pos_item_type' && String(entry?.value || '').trim().toLowerCase() === 'loyalty');
}

export function loyaltyAmountFromMeta(metadata: Array<{ key?: string; value?: unknown }>): number {
  // Metadata can be present both on the order and in store_orders_meta. The
  // latter is the authoritative/latest copy, so read from the end.
  const redeemed = [...metadata].reverse().find((item) => item?.key === 'redeemed_value');
  const legacy = [...metadata].reverse().find((item) => item?.key === 'redeem_amount');
  const redeemedValue = redeemed?.value && typeof redeemed.value === 'object'
    ? (redeemed.value as { redeem_amount?: unknown }).redeem_amount
    : redeemed?.value;
  const legacyAmount = Number(legacy?.value);
  const savedAmount = Number(redeemedValue);
  const amount = Number.isFinite(legacyAmount) && legacyAmount > 0
    ? legacyAmount
    : Number.isFinite(savedAmount) && savedAmount > 0 ? savedAmount : 0;
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function loyaltyDiscountAgainstPayable(redeemed: number, netPayableAfterTax: number): number {
  if (!(redeemed > 0) || !(netPayableAfterTax > 0)) return 0;
  return Math.round(Math.min(redeemed, netPayableAfterTax) * 100) / 100;
}

export function withLoyaltyDiscountFee<T>(fees: T[] | undefined, redeemed: number, netPayableAfterTax: number): T[] {
  const lines = Array.isArray(fees) ? [...fees] : [];
  if (lines.some((fee) => isLoyaltyDiscountFee(fee))) return lines;
  const discount = loyaltyDiscountAgainstPayable(redeemed, netPayableAfterTax);
  if (!(discount > 0)) return lines;
  lines.push(loyaltyDiscountFee(discount) as T);
  return lines;
}

function isLoyaltyDiscountFee(fee: unknown): boolean {
  const record = fee && typeof fee === 'object' ? fee as { name?: unknown; fee_name?: unknown } : {};
  const name = String(record.name || record.fee_name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return name === 'loyalty' || name === 'loyalty_discount';
}

function loyaltyDiscountFee(amount: number) {
  const value = (-Math.abs(amount)).toFixed(2);
  return {
    name: 'loyalty_discount',
    tax_class: '',
    tax_status: 'none',
    amount: value,
    total: value,
    total_tax: '0.00',
    taxes: [],
    meta_data: [],
  };
}
