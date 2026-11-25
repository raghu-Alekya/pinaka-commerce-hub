export interface PosLineItem {
  product_id?: number | string;
  name?: string;
  quantity?: number | string;
  subtotal?: number | string;
  total?: number | string;
  tax_status?: string;
  meta_data?: Array<{ key?: string; value?: unknown }>;
  taxes?: Array<{ id?: unknown; rate_percent?: unknown; total?: unknown; subtotal?: unknown }>;
}

export interface PosFeeLine {
  name?: string;
  total?: number | string;
  tax_status?: string;
}

export interface PosTaxLine {
  rate_code?: string;
  label?: string;
  rate_percent?: number;
  tax_total?: number | string;
  shipping_tax_total?: number | string;
}

export interface PosPayment {
  method?: string;
  amount?: number | string;
  status?: string;
}

export interface PosCouponLine {
  code?: string;
  discount?: number | string;
}

export type TaxCalculationMode = 'item-price' | 'subtotal' | 'total';

export interface TaxCalculationInput {
  lineItems?: PosLineItem[];
  feeLines?: PosFeeLine[];
  rate: number;
  pricesIncludeTax?: boolean;
  calculation?: TaxCalculationMode;
  decimalPlaces?: number;
  label?: string;
}

export interface StoreOrderCalculationInput {
  lineItems?: PosLineItem[];
  feeLines?: PosFeeLine[];
  taxLines?: PosTaxLine[];
  payments?: PosPayment[];
  /** When omitted, line totals stay as sent. */
  discountAmount?: number;
  /** When omitted, tax_lines stay as sent (an empty array stays empty). */
  tax?: Omit<TaxCalculationInput, 'lineItems' | 'feeLines'>;
  /** When omitted, fee lines are not included in the total. */
  includeFees?: boolean;
  /** Fee lines seen by tax. Defaults to feeLines so a merchant_discount fee reduces the tax base. */
  taxFeeLines?: PosFeeLine[];
  /** When omitted, payments stay as an empty contribution to the total. */
  includePayments?: boolean;
  /** When omitted, the cashback tier fee is not looked up. */
  includeCashbackFee?: boolean;
  cashbackAmount?: number;
  shippingTotal?: number;
  decimalPlaces?: number;
}

export interface StoreOrderTotals {
  subtotal: number;
  discountTotal: number;
  lineTotal: number;
  feeTotal: number;
  taxTotal: number;
  shippingTotal: number;
  total: number;
}

const NON_MERCHANDISE = new Set(['cashback', 'payout']);

export function isMerchandiseLine(line: PosLineItem): boolean {
  const name = String(line?.name || '').trim().toLowerCase();
  const meta = Array.isArray(line?.meta_data) ? line.meta_data : [];
  const lineTypes = meta
    .filter((entry) => entry?.key === '_pos_line_type' || entry?.key === '_pos_item_type')
    .map((entry) => String(entry?.value || '').trim().toLowerCase());
  return !NON_MERCHANDISE.has(name) && !lineTypes.some((type) => NON_MERCHANDISE.has(type));
}

export function toMinor(value: unknown, places = 2): number {
  const factor = 10 ** places;
  const numeric = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * factor);
}

export function fromMinor(minor: number, places = 2): number {
  return Math.round(minor) / 10 ** places;
}

export function sumLineSubtotals(lineItems: PosLineItem[] = [], places = 2): number {
  const minor = lineItems.reduce(
    (sum, line) => sum + toMinor(line?.subtotal ?? line?.total ?? 0, places),
    0,
  );
  return fromMinor(minor, places);
}

export function sumLineTotals(lineItems: PosLineItem[] = [], places = 2): number {
  const minor = lineItems.reduce(
    (sum, line) => sum + toMinor(line?.total ?? line?.subtotal ?? 0, places),
    0,
  );
  return fromMinor(minor, places);
}

/**
 * Complete order discount without double-counting reductions already applied
 * to line totals. POS discounts may be represented by a generated coupon line,
 * a negative merchant_discount fee, or both.
 */
export function calculateDiscountTotal(
  lineItems: PosLineItem[] = [],
  couponLines: PosCouponLine[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
): number {
  const merchandise = lineItems.filter(isMerchandiseLine);
  const lineReduction = Math.max(
    0,
    toMinor(sumLineSubtotals(merchandise, places), places)
      - toMinor(sumLineTotals(merchandise, places), places),
  );
  let couponDiscount = 0;
  let merchantCouponDiscount = 0;
  const promotionDiscount = merchandise.reduce((sum, line) => {
    const metadata = Array.isArray(line?.meta_data) ? line.meta_data : [];
    const amount = metadata.find((entry) => entry?.key === '_pos_auto_discount')?.value;
    return sum + Math.max(0, toMinor(amount ?? 0, places));
  }, 0);
  couponLines.forEach((line) => {
    const amount = Math.max(0, toMinor(line?.discount ?? 0, places));
    couponDiscount += amount;
    if (/^pos-discount(?:-\d+)?$/i.test(String(line?.code || '').trim())) {
      merchantCouponDiscount += amount;
    }
  });
  const merchantFeeDiscount = merchantDiscountMinor(feeLines, places);
  const merchantFeeOnly = Math.max(0, merchantFeeDiscount - merchantCouponDiscount);
  // A promotion amount already covered by the coupon, or already inside the
  // line gap, is one discount. Adding it again makes discount_total larger
  // than the money taken off the products.
  const couponExplainsGap = couponDiscount > 0 && lineReduction > 0 && couponDiscount >= lineReduction;
  const promotionExplainsGap = !couponExplainsGap && promotionDiscount > 0 && promotionDiscount >= lineReduction;
  const couponAndMerchantExplainGap = !couponExplainsGap
    && !promotionExplainsGap
    && lineReduction > 0
    && couponDiscount + merchantFeeOnly >= lineReduction;
  let couponInLines = 0;
  let promotionInLines = 0;
  let merchantInLines = 0;
  if (couponExplainsGap) {
    couponInLines = lineReduction;
    promotionInLines = Math.min(promotionDiscount, couponDiscount);
  } else if (promotionExplainsGap) {
    promotionInLines = lineReduction;
  } else if (couponAndMerchantExplainGap) {
    couponInLines = Math.min(couponDiscount, lineReduction);
    merchantInLines = Math.min(merchantFeeOnly, lineReduction - couponInLines);
    promotionInLines = Math.min(promotionDiscount, couponDiscount);
  } else {
    let remaining = lineReduction;
    promotionInLines = Math.min(promotionDiscount, remaining);
    remaining -= promotionInLines;
    couponInLines = Math.min(couponDiscount, remaining);
    remaining -= couponInLines;
    merchantInLines = Math.min(merchantFeeOnly, remaining);
  }
  const couponExtra = Math.max(0, couponDiscount - couponInLines);
  const promotionExtra = Math.max(0, promotionDiscount - promotionInLines);
  const merchantExtra = Math.max(0, merchantFeeOnly - merchantInLines);
  return fromMinor(lineReduction + couponExtra + merchantExtra + promotionExtra, places);
}

export function sumCouponDiscounts(couponLines: PosCouponLine[] = [], places = 2): number {
  const minor = couponLines.reduce(
    (sum, line) => sum + Math.max(0, toMinor(line?.discount ?? 0, places)),
    0,
  );
  return fromMinor(minor, places);
}

/**
 * Legacy POS payloads can carry a coupon both as coupon_lines and as a fee.
 * coupon_lines is authoritative whenever it supplies an amount. The fee is a
 * fallback only for legacy coupon lines that omit their discount value.
 */
export function authoritativeCouponDiscount(
  couponLines: PosCouponLine[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
  _lineItems: PosLineItem[] = [],
): number {
  const couponLineMinor = toMinor(sumCouponDiscounts(couponLines, places), places);
  const couponFeeMinor = feeLines.reduce((sum, fee) => (
    isCouponDiscountFee(fee) ? sum + Math.abs(toMinor(fee?.total ?? 0, places)) : sum
  ), 0);
  const chosen = couponLineMinor > 0 ? couponLineMinor : couponFeeMinor;
  return fromMinor(chosen, places);
}

function merchandiseReductionMinor(lineItems: PosLineItem[] = [], places = 2): number {
  return lineItems.filter(isMerchandiseLine).reduce((sum, line) => (
    sum + Math.max(
      0,
      toMinor(line.subtotal ?? line.total ?? 0, places) - toMinor(line.total ?? line.subtotal ?? 0, places),
    )
  ), 0);
}

function couponAmountMinor(
  couponLines: PosCouponLine[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
): number {
  const couponLineMinor = toMinor(sumCouponDiscounts(couponLines, places), places);
  if (couponLineMinor > 0) return couponLineMinor;
  return feeLines.reduce((sum, fee) => (
    isCouponDiscountFee(fee) ? sum + Math.abs(toMinor(fee?.total ?? 0, places)) : sum
  ), 0);
}

/**
 * The line gap is the coupon first. Only the remainder can be a merchant
 * discount that is already inside the line totals. A larger coupon must not
 * be treated as the merchant discount.
 */
export function isMerchantDiscountRepresented(
  lineItems: PosLineItem[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
  couponLines: PosCouponLine[] = [],
): boolean {
  const merchantMinor = merchantDiscountMinor(feeLines, places);
  if (!merchantMinor) return false;
  const lineReductionMinor = merchandiseReductionMinor(lineItems, places);
  const couponMinor = couponAmountMinor(couponLines, feeLines, places);
  const leftoverMinor = Math.max(0, lineReductionMinor - Math.min(lineReductionMinor, couponMinor));
  return leftoverMinor >= merchantMinor;
}

export function feeLinesForCalculation(
  lineItems: PosLineItem[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
  couponLines: PosCouponLine[] = [],
): PosFeeLine[] {
  return isMerchantDiscountRepresented(lineItems, feeLines, places, couponLines)
    ? feeLines.filter((fee) => !isMerchantDiscountFee(fee))
    : feeLines;
}

/** The coupon amount sent on the order. It is not compared with other discounts. */
export function couponToApply(
  lineItems: PosLineItem[] = [],
  couponLines: PosCouponLine[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
): number {
  return authoritativeCouponDiscount(couponLines, feeLines, places, lineItems);
}

function statedCouponDiscount(coupon: PosCouponLine): number {
  const record = coupon as PosCouponLine & { discount_amount?: unknown };
  const amount = Number(record?.discount ?? record?.discount_amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function isGeneratedMerchantCoupon(code: string): boolean {
  return /^pos-discount(?:-\d+)?$/i.test(code);
}

/**
 * A local store coupon can fill a missing fixed-cart amount.
 * Percentage and fixed-product coupons keep their own rules and are not
 * converted into a cart amount. An expired or missing row supplies nothing.
 */
export function fixedCartAmountFromCouponRecord(
  row: Record<string, unknown> | null | undefined,
  now = Date.now(),
): number | null {
  if (!row) return null;
  const type = String(row.discount_type ?? row.discountType ?? '').trim().toLowerCase();
  if (type !== 'fixed_cart' && type !== 'fixed') return null;
  const expiresAt = row.date_expires ?? row.dateExpires;
  if (expiresAt !== undefined && expiresAt !== null && String(expiresAt).trim() !== '') {
    const expires = new Date(String(expiresAt)).getTime();
    if (Number.isFinite(expires) && expires <= now) return null;
  }
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/**
 * Fill coupon lines that have a code but no positive discount from the local
 * fixed-cart records. When a line cannot be filled, the coupon fee is cleared
 * so it cannot become the coupon amount.
 */
export function assignFixedCartCouponDiscounts(
  sourcePayload: { coupon_lines?: PosCouponLine[]; fee_lines?: PosFeeLine[] },
  records: ReadonlyMap<string, Record<string, unknown> | null>,
  places = 2,
  now = Date.now(),
): void {
  const coupons = Array.isArray(sourcePayload.coupon_lines) ? sourcePayload.coupon_lines : [];
  let blockFeeFallback = false;
  coupons.forEach((coupon) => {
    const code = String(coupon?.code || '').trim();
    if (!code || isGeneratedMerchantCoupon(code) || statedCouponDiscount(coupon) > 0) return;
    const amount = fixedCartAmountFromCouponRecord(records.get(code.toLowerCase()) ?? null, now);
    if (amount === null) {
      blockFeeFallback = true;
      return;
    }
    coupon.discount = amount.toFixed(places);
  });
  if (!blockFeeFallback || !Array.isArray(sourcePayload.fee_lines)) return;
  sourcePayload.fee_lines.forEach((fee) => {
    if (isCouponDiscountFee(fee)) fee.total = (0).toFixed(places);
  });
}

/** Keep the coupon fee and POS coupon meta aligned with the coupon used in the total. */
export function recordAppliedCouponAmount(
  sourcePayload: {
    coupon_lines?: PosCouponLine[];
    fee_lines?: PosFeeLine[];
    meta_data?: Array<{ key?: string; value?: unknown }>;
  },
  applied: number,
  places = 2,
): void {
  const coupons = Array.isArray(sourcePayload.coupon_lines) ? sourcePayload.coupon_lines : [];
  const hasStoreCoupon = coupons.some((coupon) => {
    const code = String(coupon?.code || '').trim();
    return Boolean(code) && !isGeneratedMerchantCoupon(code);
  });
  const metadata = Array.isArray(sourcePayload.meta_data) ? sourcePayload.meta_data : [];
  const meta = metadata.find((entry) => entry?.key === '_pos_coupon_discount');
  const hasCouponFee = Array.isArray(sourcePayload.fee_lines)
    && sourcePayload.fee_lines.some((fee) => isCouponDiscountFee(fee));
  if (!hasStoreCoupon && !hasCouponFee && !meta) return;
  const text = fromMinor(toMinor(applied, places), places).toFixed(places);
  if (Array.isArray(sourcePayload.fee_lines)) {
    sourcePayload.fee_lines.forEach((fee) => {
      if (isCouponDiscountFee(fee)) fee.total = (-Number(text)).toFixed(places);
    });
  }
  if (!hasStoreCoupon && !meta) return;
  if (meta) meta.value = text;
  else {
    metadata.push({ key: '_pos_coupon_discount', value: text });
    sourcePayload.meta_data = metadata;
  }
}

type SaleLine = PosLineItem & {
  price?: unknown;
  unit_price?: unknown;
  unitPrice?: unknown;
  total_tax?: unknown;
  subtotal_tax?: unknown;
};

function metaAmount(line: PosLineItem, keys: string[], places: number): number {
  const metadata = Array.isArray(line?.meta_data) ? line.meta_data : [];
  for (const key of keys) {
    const entry = metadata.find((item) => item?.key === key);
    if (!entry || entry.value === undefined || entry.value === null || String(entry.value).trim() === '') continue;
    const amount = Math.max(0, toMinor(entry.value, places));
    if (amount > 0) return amount;
  }
  return 0;
}

/**
 * One line carries one POS discount type. `_pos_auto_discount` is the amount
 * for that type. Dedicated multipack and mix-and-match keys are extra amounts.
 */
function itemDiscountParts(line: PosLineItem, places: number): { auto: number; multipack: number; mix: number } {
  const metadata = Array.isArray(line?.meta_data) ? line.meta_data : [];
  const type = String(
    metadata.find((item) => item?.key === '_pos_discount_type' || item?.key === 'pos_discount_type')?.value || '',
  ).trim().toLowerCase();
  const shared = metaAmount(line, [
    '_pos_auto_discount', 'pos_auto_discount', '_pos_discount_amount', 'pos_discount_amount',
  ], places);
  const multipackKey = metaAmount(line, ['_pos_multipack_discount', 'pos_multipack_discount'], places);
  const mixKey = metaAmount(line, [
    '_pos_mix_match_discount', '_pos_mixmatch_discount', 'pos_mix_match_discount', 'pos_mixmatch_discount',
  ], places);
  const mixType = type === 'mixmatch' || type === 'mix_match' || type === 'mix-match';
  if (type === 'multipack') return { auto: 0, multipack: multipackKey || shared, mix: mixKey };
  if (mixType) return { auto: 0, multipack: multipackKey, mix: mixKey || shared };
  return { auto: shared, multipack: multipackKey, mix: mixKey };
}

/** Automatic, multipack, and mix-and-match amounts stored on the line. A merchant source is not included. */
export function recognizedItemDiscountMinor(line: PosLineItem, places = 2): number {
  const metadata = Array.isArray(line?.meta_data) ? line.meta_data : [];
  const source = String(
    metadata.find((item) => item?.key === '_pos_discount_source' || item?.key === 'pos_discount_source')?.value || '',
  ).trim().toLowerCase();
  if (source === 'merchant' || source === 'merchant_discount' || source === 'pos_discount') return 0;
  const parts = itemDiscountParts(line, places);
  return parts.auto + parts.multipack + parts.mix;
}

function saleLineRate(line: PosLineItem): number {
  if (!isTaxableSaleLine(line)) return 0;
  const taxes = Array.isArray(line.taxes) ? line.taxes : [];
  const rate = Number(taxes[0]?.rate_percent ?? taxes[0]?.id);
  return Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : 0;
}

/**
 * Save-time bill. Starts from the original unit price × quantity, then
 * automatic, multipack, and mix-and-match discounts, then the merchant
 * discount, then the coupon, then tax on each line's own rate.
 * Line subtotal keeps the original extended price. Line total keeps the
 * amount after the item discounts. Merchant and coupon stay on their own
 * fee and coupon rows and are included once in the order total.
 */
export function applyPosSaleCalculation(
  lines: SaleLine[] = [],
  sourcePayload: {
    coupon_lines?: PosCouponLine[];
    fee_lines?: PosFeeLine[];
    tax_lines?: Array<Record<string, unknown>>;
    total_tax?: unknown;
    cart_tax?: unknown;
    subtotal?: unknown;
    discount_total?: unknown;
    total?: unknown;
    shipping_total?: unknown;
    shippingTotal?: unknown;
    prices_include_tax?: unknown;
  },
  places = 2,
): { subtotal: number; discountTotal: number; tax: number; total: number; coupon: number; merchant: number } | null {
  const merchandise = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isMerchandiseLine(line));
  if (!merchandise.length) return null;

  const priced = merchandise.map(({ line }) => {
    const parts = itemDiscountParts(line, places);
    const requested = parts.auto + parts.multipack + parts.mix;
    const quantityValue = Number(line.quantity ?? 1);
    const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1;
    const rawUnit = line.price ?? line.unit_price ?? line.unitPrice;
    const hasUnit = rawUnit !== undefined && rawUnit !== null && String(rawUnit).trim() !== '';
    const subtotal = Math.max(0, toMinor(line.subtotal ?? line.total ?? 0, places));
    const currentTotal = Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places));
    const gap = Math.max(0, subtotal - currentTotal);
    let original = subtotal;
    let unit = 0;
    if (hasUnit) {
      unit = Math.max(0, toMinor(rawUnit, places));
      const extended = Math.round(unit * quantity);
      // A supplied unit price is the original price. A later save can already
      // have stored a larger original subtotal beside a smaller unit, and that
      // stored subtotal remains the original extended price.
      if (subtotal > extended && requested <= gap) {
        original = subtotal;
        unit = 0;
      } else {
        original = extended;
      }
    } else if (requested > gap) {
      original = subtotal + requested;
    }
    let remaining = original;
    const take = (amount: number) => {
      const used = Math.min(remaining, Math.max(0, amount));
      remaining -= used;
      return used;
    };
    const applied = {
      auto: take(parts.auto),
      multipack: take(parts.multipack),
      mix: take(parts.mix),
    };
    return { line, quantity, original, unit, applied, afterItem: remaining };
  });

  const afterItem = priced.map((entry) => entry.afterItem);
  const coupons = (Array.isArray(sourcePayload.coupon_lines) ? sourcePayload.coupon_lines : [])
    .filter((coupon) => !/^pos-discount(?:-\d+)?$/i.test(String(coupon?.code || '').trim()));
  const fees = Array.isArray(sourcePayload.fee_lines) ? sourcePayload.fee_lines : [];
  const merchantRequested = merchantDiscountMinor(fees, places);
  const afterMerchant = amountsAfterDiscount(afterItem, merchantRequested);
  const couponRequested = toMinor(couponToApply(priced.map((entry) => entry.line), coupons, fees, places), places);
  const afterCoupon = amountsAfterDiscount(afterMerchant, couponRequested);
  const merchantApplied = afterItem.reduce((sum, amount) => sum + amount, 0)
    - afterMerchant.reduce((sum, amount) => sum + amount, 0);
  const couponApplied = afterMerchant.reduce((sum, amount) => sum + amount, 0)
    - afterCoupon.reduce((sum, amount) => sum + amount, 0);

  const hadRate = priced.some((entry) => saleLineRate(entry.line) > 0);
  const taxByIndex = new Map<number, number>();
  if (hadRate) {
    const groups = new Map<number, number[]>();
    priced.forEach((entry, index) => {
      const rate = saleLineRate(entry.line);
      if (rate > 0) groups.set(rate, [...(groups.get(rate) || []), index]);
    });
    groups.forEach((indexes, rate) => {
      const allocated = allocateRoundedTax(indexes.map((index) => taxUnitsForMinor(afterCoupon[index], rate)));
      indexes.forEach((index, position) => taxByIndex.set(index, allocated[position]));
    });
  }

  let itemApplied = 0;
  priced.forEach((entry, index) => {
    itemApplied += entry.applied.auto + entry.applied.multipack + entry.applied.mix;
    const text = (minor: number) => fromMinor(minor, places).toFixed(places);
    entry.line.subtotal = text(entry.original);
    entry.line.total = text(entry.afterItem);
    const unitMinor = entry.unit > 0
      ? entry.unit
      : (Number.isInteger(entry.quantity) && entry.quantity > 0 && entry.original % entry.quantity === 0
        ? entry.original / entry.quantity
        : 0);
    if (unitMinor > 0) {
      const unitText = text(unitMinor);
      entry.line.price = unitText;
      entry.line.unit_price = unitText;
    }
    if (!hadRate) return;
    const taxMinor = taxByIndex.get(index) || 0;
    const taxText = text(taxMinor);
    entry.line.total_tax = taxText;
    entry.line.subtotal_tax = taxText;
    const rate = saleLineRate(entry.line);
    if (Array.isArray(entry.line.taxes) && entry.line.taxes[0]) {
      entry.line.taxes[0].total = taxText;
      entry.line.taxes[0].subtotal = taxText;
      if (rate > 0 && entry.line.taxes[0].rate_percent === undefined) entry.line.taxes[0].rate_percent = rate;
    } else if (rate > 0) {
      entry.line.taxes = [{ id: rate, rate_percent: rate, total: taxText, subtotal: taxText }];
    }
  });

  const otherMinor = lines.reduce((sum, line) => (
    isMerchandiseLine(line) ? sum : sum + toMinor(line.total ?? line.subtotal ?? 0, places)
  ), 0);
  // Merchant and coupon are already in the total. Cashback fees, payout fees,
  // and card charges stay on their own fee rows and are added once here.
  const otherFeeMinor = fees.reduce((sum, fee) => (
    isMerchantDiscountFee(fee) || isCouponDiscountFee(fee) ? sum : sum + toMinor(fee?.total ?? 0, places)
  ), 0);
  const taxableFeeMinor = fees.reduce((sum, fee) => {
    if (isMerchantDiscountFee(fee) || isCouponDiscountFee(fee) || isPayoutFee(fee)) return sum;
    if (String(fee?.tax_status || 'taxable').trim().toLowerCase() === 'none') return sum;
    return sum + toMinor(fee?.total ?? 0, places);
  }, 0);
  const subtotalMinor = lines.reduce((sum, line) => sum + toMinor(line.subtotal ?? line.total ?? 0, places), 0);
  const shippingMinor = toMinor(sourcePayload.shipping_total ?? sourcePayload.shippingTotal ?? 0, places);
  const afterItemMinor = afterItem.reduce((sum, amount) => sum + amount, 0);
  const lineRates = [...new Set(priced.map((entry) => saleLineRate(entry.line)).filter((rate) => rate > 0))];
  const feeTaxMinor = hadRate && taxableFeeMinor !== 0 && lineRates.length === 1
    ? allocateRoundedTax([taxUnitsForMinor(taxableFeeMinor, lineRates[0])])[0] || 0
    : 0;
  const taxMinor = hadRate
    ? [...taxByIndex.values()].reduce((sum, amount) => sum + amount, 0) + feeTaxMinor
    : Math.max(0, toMinor(
      sourcePayload.total_tax ?? lines.reduce((sum, line) => sum + Number(line.total_tax ?? 0), 0),
      places,
    ));
  if (hadRate) {
    const existing = Array.isArray(sourcePayload.tax_lines) ? sourcePayload.tax_lines : [];
    const grouped = new Map<number, number>();
    priced.forEach((entry, index) => {
      const rate = saleLineRate(entry.line);
      if (rate > 0) grouped.set(rate, (grouped.get(rate) || 0) + (taxByIndex.get(index) || 0));
    });
    if (feeTaxMinor && lineRates.length === 1) {
      grouped.set(lineRates[0], (grouped.get(lineRates[0]) || 0) + feeTaxMinor);
    }
    sourcePayload.tax_lines = [...grouped.entries()].map(([rate, minor], index) => {
      const previous = existing.find((line) => Number(line?.rate_percent) === rate) || {};
      return {
        ...previous,
        id: previous.id ?? index + 1,
        rate_code: previous.rate_code || `POS-TAX-${index + 1}`,
        rate_id: previous.rate_id ?? index + 1,
        label: previous.label || 'Tax',
        compound: previous.compound ?? false,
        tax_total: fromMinor(minor, places).toFixed(places),
        shipping_tax_total: previous.shipping_tax_total || fromMinor(0, places).toFixed(places),
        rate_percent: rate,
        meta_data: previous.meta_data || [],
      };
    });
    sourcePayload.total_tax = fromMinor(taxMinor, places).toFixed(places);
    sourcePayload.cart_tax = sourcePayload.total_tax;
  }
  const discountMinor = itemApplied + merchantApplied + couponApplied;
  const total = orderTotalWithTax({
    netBeforeTax: fromMinor(
      afterItemMinor - merchantApplied - couponApplied + otherMinor + otherFeeMinor + shippingMinor,
      places,
    ),
    tax: fromMinor(taxMinor, places),
    pricesIncludeTax: Boolean(sourcePayload.prices_include_tax),
    decimalPlaces: places,
  });
  sourcePayload.subtotal = fromMinor(subtotalMinor, places).toFixed(places);
  sourcePayload.discount_total = fromMinor(discountMinor, places).toFixed(places);
  sourcePayload.total = total.toFixed(places);
  return {
    subtotal: fromMinor(subtotalMinor, places),
    discountTotal: fromMinor(discountMinor, places),
    tax: fromMinor(taxMinor, places),
    total,
    coupon: fromMinor(couponApplied, places),
    merchant: fromMinor(merchantApplied, places),
  };
}

export function representedCouponDiscount(
  lineItems: PosLineItem[] = [],
  feeLines: PosFeeLine[] = [],
  places = 2,
  couponLines: PosCouponLine[] = [],
): number {
  const lineReductionMinor = merchandiseReductionMinor(lineItems, places);
  const couponMinor = couponAmountMinor(couponLines, feeLines, places);
  return fromMinor(Math.min(lineReductionMinor, couponMinor), places);
}

/**
 * Spreads a fixed amount across merchandise lines by subtotal.
 * The last merchandise line takes the remainder. Cashback and Payout lines are unchanged.
 */
export function allocateFixedDiscount(
  lineItems: PosLineItem[] = [],
  amount: number,
  places = 2,
): PosLineItem[] {
  const discount = Math.max(0, toMinor(amount, places));
  const merchandise = lineItems
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isMerchandiseLine(line));
  const base = merchandise.reduce(
    (sum, { line }) => sum + Math.max(0, toMinor(line.subtotal ?? line.total ?? 0, places)),
    0,
  );
  if (!discount || !base) return lineItems.map((line) => ({ ...line }));

  let allocated = 0;
  const reductions = new Map<number, number>();
  merchandise.forEach(({ line, index }, position) => {
    const subtotal = Math.max(0, toMinor(line.subtotal ?? line.total ?? 0, places));
    const isLast = position === merchandise.length - 1;
    const share = isLast ? Math.max(0, discount - allocated) : Math.round((discount * subtotal) / base);
    const reduction = Math.min(subtotal, share);
    allocated += reduction;
    reductions.set(index, reduction);
  });

  return lineItems.map((line, index) => {
    const reduction = reductions.get(index);
    if (reduction == null) return { ...line };
    const subtotal = Math.max(0, toMinor(line.subtotal ?? line.total ?? 0, places));
    return { ...line, total: fromMinor(subtotal - reduction, places).toFixed(places) };
  });
}

export function calculateFeeTotal(feeLines: PosFeeLine[] = [], places = 2): number {
  const minor = feeLines.reduce((sum, fee) => sum + toMinor(fee?.total ?? 0, places), 0);
  return fromMinor(minor, places);
}

export function sumPayments(payments: PosPayment[] = [], places = 2): number {
  const minor = payments.reduce((sum, payment) => sum + toMinor(payment?.amount ?? 0, places), 0);
  return fromMinor(minor, places);
}

export function sumPaymentsByMethod(payments: PosPayment[] = [], method: string, places = 2): number {
  const target = method.trim().toLowerCase();
  const matched = payments.filter((payment) => String(payment?.method || '').trim().toLowerCase() === target);
  return sumPayments(matched, places);
}

function isEbtEligible(line: PosLineItem): boolean {
  const meta = Array.isArray(line.meta_data) ? line.meta_data : [];
  const value = meta.find((entry) => entry?.key === '_is_ebt_eligible')?.value;
  return value === 1 || value === '1' || value === true;
}

function feeKey(fee: { name?: string; fee_name?: string } | null | undefined): string {
  return String(fee?.name || fee?.fee_name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isMerchantDiscountFee(fee: { name?: string; fee_name?: string } | null | undefined): boolean {
  const name = feeKey(fee);
  return name === 'merchant_discount' || name.startsWith('merchant_discount_');
}

export function isCouponDiscountFee(fee: { name?: string; fee_name?: string } | null | undefined): boolean {
  const name = feeKey(fee);
  return name === 'coupon_discount' || name.startsWith('coupon_discount_');
}

/** A payout is a cash disbursement, not a supply, so it is outside the tax base. */
export function isPayoutFee(fee: { name?: string; fee_name?: string } | null | undefined): boolean {
  const name = feeKey(fee);
  return name === 'payout' || name.startsWith('payout_');
}

export function isCashbackFee(fee: { name?: string; fee_name?: string } | null | undefined): boolean {
  const name = feeKey(fee);
  // The cashback principal is a cash movement, but "Cashback Fee" is a real
  // order charge and must remain in receipt/list totals.
  return name === 'cashback' || name === 'cashback_amount';
}

export function isTaxableSaleLine(line: PosLineItem): boolean {
  if (!isMerchandiseLine(line) || isEbtEligible(line)) return false;
  if (String(line?.tax_status || '').trim().toLowerCase() === 'none') return false;
  const meta = Array.isArray(line.meta_data) ? line.meta_data : [];
  const lineTypes = meta
    .filter((entry) => entry?.key === '_pos_line_type' || entry?.key === '_pos_item_type')
    .map((entry) => String(entry?.value || '').trim().toLowerCase());
  return !lineTypes.includes('cashback') && !lineTypes.includes('payout');
}

export function merchantDiscountMinor(
  feeLines: Array<{ name?: string; fee_name?: string; total?: unknown }> = [],
  places = 2,
): number {
  return feeLines.reduce((sum, fee) => {
    if (!isMerchantDiscountFee(fee)) return sum;
    return sum + Math.abs(toMinor(fee?.total ?? 0, places));
  }, 0);
}

/** Coupon fees mirror coupon_lines for Woo compatibility; line totals already carry the reduction. */
export function effectiveFeeTotal(
  feeLines: PosFeeLine[] = [],
  places = 2,
): number {
  return fromMinor(feeLines.reduce((sum, fee) => (
    isCouponDiscountFee(fee) ? sum : sum + toMinor(fee?.total ?? 0, places)
  ), 0), places);
}

function exactTaxForAmounts(
  lines: Array<PosLineItem & { taxes?: unknown }>,
  amounts: number[],
): number[] | null {
  const rates = lines.map((line) => {
    const taxes = Array.isArray(line.taxes) ? line.taxes : [];
    const rate = Number((taxes[0] as { rate_percent?: unknown; id?: unknown } | undefined)?.rate_percent
      ?? (taxes[0] as { id?: unknown } | undefined)?.id);
    return Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : 0;
  });
  const missingRateOnTaxedLine = lines.some((line, index) => {
    if (rates[index] > 0) return false;
    const stored = Number((line as { total_tax?: unknown }).total_tax ?? 0);
    return Number.isFinite(stored) && stored !== 0;
  });
  if (missingRateOnTaxedLine || rates.every((rate) => rate <= 0)) return null;
  const result = new Array(lines.length).fill(0);
  const groups = new Map<number, number[]>();
  rates.forEach((rate, index) => {
    if (rate > 0) groups.set(rate, [...(groups.get(rate) || []), index]);
  });
  groups.forEach((indexes, rate) => {
    const allocated = allocateRoundedTax(indexes.map((index) => taxUnitsForMinor(amounts[index], rate)));
    indexes.forEach((index, position) => { result[index] = allocated[position]; });
  });
  return result;
}

function amountsAfterDiscount(amounts: number[], discountMinor: number): number[] {
  const base = amounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(0, discountMinor), base);
  if (!discount || !base) return amounts;
  let allocated = 0;
  return amounts.map((amount, index) => {
    const isLast = index === amounts.length - 1;
    const share = isLast ? discount - allocated : Math.round((discount * amount) / base);
    const reduction = Math.min(amount, Math.max(0, share));
    allocated += reduction;
    return amount - reduction;
  });
}

function taxOn(amountMinor: number, ratePercent: number, pricesIncludeTax: boolean): number {
  if (amountMinor === 0 || ratePercent <= 0) return 0;
  const rate = ratePercent / 100;
  const sign = amountMinor < 0 ? -1 : 1;
  const amount = Math.abs(amountMinor);
  const tax = pricesIncludeTax
    ? Math.round(amount - amount / (1 + rate))
    : Math.round(amount * rate);
  return sign * tax;
}

const TAX_RATE_HUNDREDTHS = 100;
const TAX_UNIT_SCALE = 100 * TAX_RATE_HUNDREDTHS;

/**
 * Unrounded tax for one line, in hundredths of a minor unit.
 * A 9.10% rate stays an integer (910) so the lines can be added before rounding.
 */
export function taxUnitsForMinor(amountMinor: number, ratePercent: number): number {
  if (!amountMinor || !Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  const rateHundredths = Math.round(ratePercent * TAX_RATE_HUNDREDTHS);
  if (rateHundredths <= 0) return 0;
  const sign = amountMinor < 0 ? -1 : 1;
  return sign * Math.abs(Math.trunc(amountMinor)) * rateHundredths;
}

/**
 * Round a rate group once, then spread that result across the lines.
 * Rounding each line first and then adding those cents is what turns 2.6445 into 2.65.
 */
export function allocateRoundedTax(units: number[]): number[] {
  if (!units.length) return [];
  const totalUnits = units.reduce((sum, value) => sum + value, 0);
  const direction = totalUnits < 0 ? -1 : 1;
  const target = direction * Math.round(Math.abs(totalUnits) / TAX_UNIT_SCALE);
  const shares = units.map((value) => {
    const sign = value < 0 ? -1 : 1;
    const absolute = Math.abs(value);
    return {
      sign,
      minor: sign * Math.trunc(absolute / TAX_UNIT_SCALE),
      remainder: absolute % TAX_UNIT_SCALE,
    };
  });
  let leftover = target - shares.reduce((sum, share) => sum + share.minor, 0);
  const ranked = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  const step = leftover > 0 ? 1 : -1;
  let guard = 0;
  while (leftover !== 0 && ranked.length && guard < units.length * 4) {
    shares[ranked[guard % ranked.length].index].minor += step;
    leftover -= step;
    guard += 1;
  }
  return shares.map((share) => share.minor);
}

/**
 * A cart merchant discount belongs to every real item, including a zero-tax item.
 * Cashback and payout rows stay outside this base.
 */
function reducedMerchandiseAmounts<T extends PosLineItem>(
  lines: readonly T[],
  feeLines: PosFeeLine[] | undefined,
  places: number,
): { line: T; amount: number; reduced: number }[] {
  const priced = lines
    .filter((line) => isMerchandiseLine(line))
    .map((line) => ({ line, amount: Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places)) }));
  const base = priced.reduce((sum, entry) => sum + entry.amount, 0);
  const discount = Math.min(merchantDiscountMinor(feeLines, places), base);
  const reduced = amountsAfterDiscount(priced.map((entry) => entry.amount), discount);
  return priced.map((entry, index) => ({ ...entry, reduced: reduced[index] }));
}

/** Returns [] when no rate is supplied or the computed tax is zero. */
export function calculateTaxLines(input: TaxCalculationInput): PosTaxLine[] {
  const places = input.decimalPlaces ?? 2;
  const rate = Number(input.rate || 0);
  if (rate <= 0) return [];

  const pricesIncludeTax = Boolean(input.pricesIncludeTax);
  const merchandise = reducedMerchandiseAmounts(input.lineItems || [], input.feeLines, places);
  const taxableMinor = merchandise.reduce((sum, entry) => (
    isTaxableSaleLine(entry.line) ? sum + entry.reduced : sum
  ), 0);
  const feeAmounts = (input.feeLines || [])
    .filter((fee) => !isMerchantDiscountFee(fee)
      && !isPayoutFee(fee)
      && String(fee?.tax_status || 'taxable').toLowerCase() !== 'none')
    .map((fee) => toMinor(fee?.total ?? 0, places));

  // POS and Flutter both calculate on the final combined taxable balance and
  // round once. Never sum independently rounded item taxes.
  const taxMinor = taxOn(
    Math.max(0, taxableMinor + feeAmounts.reduce((sum, amount) => sum + amount, 0)),
    rate,
    pricesIncludeTax,
  );

  if (!taxMinor) return [];
  return [{
    rate_code: 'POS-TAX-1',
    label: input.label || 'Tax',
    rate_percent: rate,
    tax_total: fromMinor(taxMinor, places).toFixed(places),
    shipping_tax_total: fromMinor(0, places).toFixed(places),
  }];
}

/** Preserve the saved tax, including the original per-item rounding. */
export function listOrderTax(input: {
  tax?: unknown;
  lineItems?: ReadonlyArray<PosLineItem>;
  feeLines?: ReadonlyArray<PosFeeLine>;
  taxLines?: ReadonlyArray<PosTaxLine>;
  decimalPlaces?: number;
}): number {
  const places = input.decimalPlaces ?? 2;
  return fromMinor(Math.max(0, toMinor(input.tax, places)), places);
}

/**
 * A merchant_discount fee is not part of the line total. Calculate tax on each
 * taxable item after its own share of that cart discount. A zero-tax item still
 * keeps its share, so the full discount is not moved onto the taxable item.
 */
export function applyMerchantDiscountToStoredTax(
  lines: Array<PosLineItem & { total_tax?: unknown; subtotal_tax?: unknown; taxes?: unknown }>,
  feeLines: PosFeeLine[] | undefined,
  orderTax: { total_tax?: unknown; cart_tax?: unknown; tax_lines?: Array<{ tax_total?: unknown }> },
  places = 2,
): void {
  const merchandise = reducedMerchandiseAmounts(lines, feeLines, places);
  const base = merchandise.reduce((sum, entry) => sum + entry.amount, 0);
  const discount = Math.min(merchantDiscountMinor(feeLines, places), base);
  if (!base) return;

  const taxable = merchandise.filter((entry) => isTaxableSaleLine(entry.line));
  let oldLineTax = 0;
  const exactTax = exactTaxForAmounts(
    taxable.map((entry) => entry.line),
    taxable.map((entry) => entry.reduced),
  );
  if (!discount && !exactTax) return;
  const nextTax = taxable.map((entry, index) => {
    const oldMinor = Math.max(0, toMinor(entry.line.total_tax ?? 0, places));
    const nextMinor = exactTax?.[index]
      ?? (entry.amount > 0 ? Math.round((oldMinor * entry.reduced) / entry.amount) : 0);
    oldLineTax += oldMinor;
    return nextMinor;
  });
  taxable.forEach((entry, index) => {
    const line = entry.line;
    const oldMinor = Math.max(0, toMinor(line.total_tax ?? 0, places));
    if (!oldMinor && !exactTax) return;
    const next = fromMinor(nextTax[index], places).toFixed(places);
    const subtotalMatched = toMinor(line.subtotal_tax ?? 0, places) === oldMinor;
    line.total_tax = next;
    if (subtotalMatched) line.subtotal_tax = next;
    if (Array.isArray(line.taxes)) {
      line.taxes.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const record = entry as { total?: unknown; subtotal?: unknown };
        record.total = next;
        if (subtotalMatched) record.subtotal = next;
      });
    }
  });

  const previousOrderTax = Math.max(0, toMinor(orderTax.total_tax ?? 0, places));
  const basisOld = oldLineTax > 0 ? oldLineTax : previousOrderTax;
  const basisNew = exactTax
    ? nextTax.reduce((sum, amount) => sum + amount, 0)
    : oldLineTax > 0
    ? nextTax.reduce((sum, amount) => sum + amount, 0)
    : Math.round((previousOrderTax * (base - discount)) / base);
  if (basisOld <= 0 || basisNew === basisOld) return;
  orderTax.total_tax = fromMinor(basisNew, places).toFixed(places);
  if (orderTax.cart_tax !== undefined) orderTax.cart_tax = orderTax.total_tax;
  (orderTax.tax_lines || []).forEach((taxLine) => {
    const current = toMinor(taxLine.tax_total ?? 0, places);
    taxLine.tax_total = fromMinor(Math.round((current * basisNew) / basisOld), places).toFixed(places);
  });
}

/** Keep the tax saved at order creation. Coupon fee rows are aligned to the saved coupon amount for display. */
export function correctStoredDiscountTax(
  storedLines: unknown[],
  storedFees: unknown[],
  storedTaxLines: unknown[],
  couponLines: unknown[],
  storedTax: unknown,
) {
  const lineItems = storedLines.map((line: any) => ({
    ...line,
    taxes: Array.isArray(line?.taxes) ? line.taxes.map((tax: any) => ({ ...tax })) : line?.taxes,
  }));
  const feeLines = storedFees.map((fee: any) => ({ ...fee }));
  const taxLines = storedTaxLines.map((line: any) => ({ ...line }));
  const calculationFees = feeLinesForCalculation(lineItems as any[], feeLines as any[], 2, couponLines as any[]);
  const couponDiscount = authoritativeCouponDiscount(
    couponLines as any[],
    feeLines as any[],
    2,
    lineItems as any[],
  );
  const hasReliableRates = lineItems.some((line: any) => Array.isArray(line?.taxes)
    && line.taxes.some((tax: any) => {
      const rate = Number(tax?.rate_percent ?? tax?.id);
      return Number.isFinite(rate) && rate > 0 && rate <= 100;
    }));
  if (hasReliableRates && couponDiscount > 0) {
    feeLines.forEach((fee: any) => {
      const name = String(fee?.name || fee?.fee_name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (name === 'coupon_discount') fee.total = (-couponDiscount).toFixed(2);
    });
  }
  return {
    lineItems,
    feeLines,
    calculationFees,
    taxLines,
    tax: storedTax,
    corrected: false,
  };
}

/**
 * Woo coupon lines do not always arrive with their reduction reflected in the
 * line totals. Apply only the unrepresented coupon balance to merchandise and
 * scale stored taxes before the merchant-discount fee is processed.
 */
export function applyCouponDiscountToStoredLinesAndTax(
  lines: Array<PosLineItem & { total_tax?: unknown; subtotal_tax?: unknown; taxes?: unknown }>,
  couponLines: PosCouponLine[] | undefined,
  orderTax: { total_tax?: unknown; cart_tax?: unknown; tax_lines?: Array<{ tax_total?: unknown }> },
  places = 2,
  representedCouponAmount?: number,
): void {
  const merchandise = lines.filter(isMerchandiseLine);
  const couponMinor = (couponLines || []).reduce((sum, coupon) => {
    if (/^pos-discount(?:-\d+)?$/i.test(String(coupon?.code || '').trim())) return sum;
    return sum + Math.max(0, toMinor(coupon?.discount ?? 0, places));
  }, 0);
  const representedMinor = representedCouponAmount === undefined
    ? Math.max(
      0,
      merchandise.reduce((sum, line) => (
        sum + Math.max(
          0,
          toMinor(line.subtotal ?? line.total ?? 0, places) - toMinor(line.total ?? line.subtotal ?? 0, places),
        )
      ), 0),
    )
    : Math.max(0, toMinor(representedCouponAmount, places));
  const currentAmounts = merchandise.map((line) => Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places)));
  const base = currentAmounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(0, couponMinor - representedMinor), base);
  if (!discount || !base) return;

  const reducedAmounts = amountsAfterDiscount(currentAmounts, discount);
  let previousTax = 0;
  let nextTaxTotal = 0;
  const taxableIndexes = merchandise
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isTaxableSaleLine(line));
  const exactTax = exactTaxForAmounts(
    taxableIndexes.map(({ line }) => line),
    taxableIndexes.map(({ index }) => reducedAmounts[index]),
  );
  const exactByIndex = new Map(taxableIndexes.map(({ index }, position) => [index, exactTax?.[position]]));
  merchandise.forEach((line, index) => {
    const previousAmount = currentAmounts[index];
    const nextAmount = reducedAmounts[index];
    line.total = fromMinor(nextAmount, places).toFixed(places);
    if (!isTaxableSaleLine(line)) return;

    const oldTax = Math.max(0, toMinor(line.total_tax ?? 0, places));
    const nextTax = exactByIndex.get(index)
      ?? (previousAmount > 0 ? Math.round((oldTax * nextAmount) / previousAmount) : 0);
    previousTax += oldTax;
    nextTaxTotal += nextTax;
    line.total_tax = fromMinor(nextTax, places).toFixed(places);
    if (Array.isArray(line.taxes)) {
      line.taxes.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        (entry as { total?: unknown }).total = line.total_tax;
      });
    }
  });

  const previousOrderTax = Math.max(0, toMinor(orderTax.total_tax ?? 0, places));
  const basisOld = previousTax > 0 ? previousTax : previousOrderTax;
  const basisNew = previousTax > 0
    ? nextTaxTotal
    : Math.round((previousOrderTax * (base - discount)) / base);
  if (basisOld <= 0 || basisNew === basisOld) return;
  orderTax.total_tax = fromMinor(basisNew, places).toFixed(places);
  if (orderTax.cart_tax !== undefined) orderTax.cart_tax = orderTax.total_tax;
  (orderTax.tax_lines || []).forEach((taxLine) => {
    const current = toMinor(taxLine.tax_total ?? 0, places);
    taxLine.tax_total = fromMinor(Math.round((current * basisNew) / basisOld), places).toFixed(places);
  });
}

/**
 * Order total: line totals + fees + shipping.
 * Tax is reported separately and is not added into the total.
 * Discount is already inside line totals, so it is not subtracted again.
 * Fees and payments are included only when the caller asks for them.
 */
export function calculateOrderTotal(input: {
  lineItems?: PosLineItem[];
  feeLines?: PosFeeLine[];
  taxLines?: PosTaxLine[];
  shippingTotal?: number;
  decimalPlaces?: number;
}): StoreOrderTotals {
  const places = input.decimalPlaces ?? 2;
  const subtotal = sumLineSubtotals(input.lineItems, places);
  const lineTotal = sumLineTotals(input.lineItems, places);
  const feeTotal = effectiveFeeTotal(input.feeLines, places);
  const taxMinor = (input.taxLines || []).reduce(
    (sum, tax) => sum + toMinor(tax?.tax_total ?? 0, places) + toMinor(tax?.shipping_tax_total ?? 0, places),
    0,
  );
  const taxTotal = fromMinor(taxMinor, places);
  const shippingTotal = fromMinor(toMinor(input.shippingTotal ?? 0, places), places);
  const discountTotal = fromMinor(Math.max(0, toMinor(subtotal, places) - toMinor(lineTotal, places)), places);
  const total = fromMinor(
    toMinor(lineTotal, places) + toMinor(feeTotal, places) + toMinor(shippingTotal, places),
    places,
  );
  return { subtotal, discountTotal, lineTotal, feeTotal, taxTotal, shippingTotal, total };
}

/**
 * Amount written to store_orders.total. Line totals, fees, and shipping are
 * tax-exclusive, so tax is added here. A payout net stays negative. Tax is
 * not added again when the line prices already include it.
 */
export function orderTotalWithTax(input: {
  netBeforeTax: number;
  tax?: number;
  pricesIncludeTax?: boolean;
  decimalPlaces?: number;
}): number {
  const places = input.decimalPlaces ?? 2;
  const netMinor = toMinor(input.netBeforeTax, places);
  const taxMinor = input.pricesIncludeTax ? 0 : toMinor(input.tax ?? 0, places);
  return fromMinor(netMinor + taxMinor, places);
}

/**
 * Older orders stored a tax-inclusive total. Orders saved after tax was removed
 * already match the line, fee, shipping, and tip sum, so tax is not removed twice.
 */
export function totalExcludingTax(input: {
  total: unknown;
  tax?: unknown;
  lineItems?: ReadonlyArray<{ total?: unknown; subtotal?: unknown; name?: string }>;
  feeLines?: ReadonlyArray<{ total?: unknown; name?: string }>;
  shippingTotal?: unknown;
  tip?: unknown;
  decimalPlaces?: number;
}): number {
  const places = input.decimalPlaces ?? 2;
  const totalMinor = toMinor(input.total, places);
  const taxMinor = Math.max(0, toMinor(input.tax, places));
  if (taxMinor <= 0 || totalMinor <= 0) return fromMinor(Math.max(0, totalMinor), places);

  if (input.lineItems) {
    const exclusiveMinor = toMinor(sumLineTotals(input.lineItems as PosLineItem[], places), places)
      + toMinor(calculateFeeTotal(input.feeLines as PosFeeLine[], places), places)
      + toMinor(input.shippingTotal ?? 0, places)
      + toMinor(input.tip ?? 0, places);
    if (Math.abs(totalMinor - exclusiveMinor) <= 2) return fromMinor(totalMinor, places);
  }
  return fromMinor(Math.max(0, totalMinor - taxMinor), places);
}

/** Order-list total. Adds tax only when the stored total does not already include it. */
export function totalIncludingTax(input: {
  total: unknown;
  tax?: unknown;
  lineItems?: ReadonlyArray<{ total?: unknown; subtotal?: unknown; name?: string }>;
  feeLines?: ReadonlyArray<{ total?: unknown; name?: string }>;
  shippingTotal?: unknown;
  tip?: unknown;
  decimalPlaces?: number;
}): number {
  const places = input.decimalPlaces ?? 2;
  const totalMinor = toMinor(input.total, places);
  const taxMinor = Math.max(0, toMinor(input.tax, places));
  if (taxMinor <= 0) return fromMinor(Math.max(0, totalMinor), places);

  if (input.lineItems) {
    const exclusiveMinor = toMinor(sumLineTotals(input.lineItems as PosLineItem[], places), places)
      + toMinor(calculateFeeTotal(input.feeLines as PosFeeLine[], places), places)
      + toMinor(input.shippingTotal ?? 0, places)
      + toMinor(input.tip ?? 0, places);
    if (Math.abs(totalMinor - exclusiveMinor) <= 2) return fromMinor(totalMinor + taxMinor, places);
  }
  return fromMinor(Math.max(0, totalMinor), places);
}

/**
 * List total: receipt net payable after coupons and fees, plus tax.
 * Payout and cashback are cash-movement lines, but they are still part of the
 * amount printed as Net Payable on the receipt and therefore remain in this
 * presentation total.
 * A stored total that left out a merchant discount is rebuilt from the lines.
 * A stored total the lines cannot explain is left unchanged.
 */
export function listOrderTotal(input: {
  total: unknown;
  tax?: unknown;
  taxLines?: ReadonlyArray<PosTaxLine>;
  couponDiscount?: unknown;
  lineItems?: ReadonlyArray<{ total?: unknown; subtotal?: unknown; name?: string }>;
  feeLines?: ReadonlyArray<{ total?: unknown; name?: string }>;
  shippingTotal?: unknown;
  tip?: unknown;
  decimalPlaces?: number;
}): number {
  const places = input.decimalPlaces ?? 2;
  const lines = input.lineItems;
  if (!lines?.length) return totalIncludingTax(input);

  const sourceLines = lines as PosLineItem[];
  const hasCashMovement = sourceLines.some((line) => !isMerchandiseLine(line));
  const lineTotalMinor = toMinor(sumLineTotals(sourceLines, places), places);
  const lineSubtotalMinor = toMinor(sumLineSubtotals(sourceLines, places), places);
  const sourceFees = (input.feeLines || []) as PosFeeLine[];
  const hasCashMovementFee = sourceFees.some((fee) => isPayoutFee(fee) || isCashbackFee(fee));
  const feeMinorTotal = toMinor(effectiveFeeTotal(sourceFees, places), places);
  const shippingMinor = toMinor(input.shippingTotal ?? 0, places);
  const tipMinor = toMinor(input.tip ?? 0, places);
  const taxMinor = Math.max(0, toMinor(listOrderTax({
    tax: input.tax,
    lineItems: sourceLines,
    feeLines: sourceFees,
    taxLines: input.taxLines,
    decimalPlaces: places,
  }), places));
  const appliedInLines = Math.max(0, lineSubtotalMinor - lineTotalMinor);
  const extraDiscount = Math.max(0, toMinor(input.couponDiscount ?? 0, places) - appliedInLines);
  const payableMinor = lineTotalMinor + feeMinorTotal + shippingMinor + tipMinor - extraDiscount;
  if (hasCashMovement || hasCashMovementFee) {
    return fromMinor(payableMinor + taxMinor, places);
  }
  const storedMinor = toMinor(input.total, places);
  const close = (amount: number) => Math.abs(storedMinor - amount) <= 2;
  if (close(payableMinor + taxMinor) && !close(payableMinor)) return fromMinor(storedMinor, places);
  if (close(payableMinor)) return fromMinor(payableMinor + taxMinor, places);

  const omittedMinor = sourceFees.reduce((sum, fee) => {
    const amount = toMinor(fee?.total ?? 0, places);
    const name = String(fee?.name || '').toLowerCase();
    return name.includes('discount') || amount <= 0 ? sum + amount : sum;
  }, 0);
  const withoutOmitted = payableMinor - omittedMinor;
  if (omittedMinor !== 0 && (close(withoutOmitted) || close(withoutOmitted + taxMinor))) {
    return fromMinor(payableMinor + taxMinor, places);
  }
  return totalIncludingTax(input);
}

export function calculateStoreOrder(input: StoreOrderCalculationInput = {}) {
  const places = input.decimalPlaces ?? input.tax?.decimalPlaces ?? 2;
  const sourceLines = input.lineItems || [];
  const lineItems = input.discountAmount === undefined
    ? sourceLines
    : allocateFixedDiscount(sourceLines, input.discountAmount, places);
  const feeLines = input.feeLines || [];
  const appliedFees = input.includeFees ? feeLines : [];
  const taxLines = input.tax
    ? calculateTaxLines({
      ...input.tax,
      lineItems,
      feeLines: input.taxFeeLines ?? feeLines,
      decimalPlaces: places,
    })
    : (input.taxLines || []);
  const payments = input.includePayments ? (input.payments || []) : [];
  return {
    lineItems,
    feeLines,
    taxLines,
    payments,
    paymentTotal: input.includePayments ? sumPayments(input.payments || [], places) : 0,
    totals: calculateOrderTotal({
      lineItems,
      feeLines: appliedFees,
      taxLines,
      shippingTotal: input.shippingTotal,
      decimalPlaces: places,
    }),
  };
}

/** WooCommerce admin-app summary over store-scoped, date-filtered source rows. */
export function adminOrderCounts(input: { businessName: string; orders: Record<string, any>[]; payments: Record<string, any>[]; refunds: Record<string, any>[]; categories: Record<string, any>[]; products: Record<string, any>[] }) {
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const status = (value: unknown) => String(value || '').toLowerCase().replace(/^wc-/, '');
  const products = new Map(input.products.map(product => [String(product.id), product]));
  const categorySales = new Map<string, number>();
  const saleStatuses = new Set(['completed', 'processing', 'paid', 'partially-refunded', 'partial-refund']);
  let totalAmount = 0, cancelled = 0, payouts = 0, cashbacks = 0, voidItems = 0;
  for (const order of input.orders) {
    const cancelledOrder = ['cancelled', 'canceled'].includes(status(order.status));
    if (cancelledOrder) cancelled++;
    const saleOrder = saleStatuses.has(status(order.status));
    if (saleOrder) totalAmount += Number(order.total || 0);
    for (const line of Array.isArray(order.line_items) ? order.line_items : []) {
      const meta = Array.isArray(line.meta_data) ? line.meta_data : [];
      const voidFlag = meta.find((item: any) => item.key === 'void')?.value;
      const isVoid = line.void === true || line.is_void === true || line.voided === true || String(line.status || '').toLowerCase() === 'void' || [true, 1, '1', 'true'].includes(voidFlag);
      if (isVoid) { voidItems++; continue; }
      if (!saleOrder) continue;
      const amount = Number(line.total ?? line.total_price ?? 0) || 0;
      if (String(line.type || '').toLowerCase() === 'payout' || /^payout(?:$|[_\s-])/i.test(String(line.name || ''))) payouts += amount;
      const lineName = String(line.name || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
      const cashbackPrincipal = ['cashback', 'cashback amount'].includes(lineName)
        || String(line.type || '').toLowerCase() === 'cashback';
      if (!cancelledOrder && cashbackPrincipal && !lineName.startsWith('cashback fee')) cashbacks += Math.abs(amount);
      if (cashbackPrincipal || String(line.type || '').toLowerCase() === 'payout' || /^payout(?:$|[_\s-])/i.test(String(line.name || ''))) continue;
      const product = products.get(String(line.product_id ?? line.productId ?? ''));
      const categories = product?.categories ?? line.categories ?? (line.category_id != null ? [{ id: line.category_id }] : []);
      for (const id of new Set((Array.isArray(categories) ? categories : []).map((category: any) => String(category.id ?? category)))) {
        categorySales.set(String(id), (categorySales.get(String(id)) || 0) + amount);
      }
    }
  }
  let cash = 0, card = 0, ebt = 0;
  const collectedStatuses = new Set(['', 'completed', 'paid', 'processing', 'refunded', 'partially-refunded', 'partial-refund']);
  for (const payment of input.payments) {
    if (payment.is_void || String(payment.entry_type || 'payment').toLowerCase() !== 'payment' || payment.payment_type === 'vendor_payment') continue;
    if (!collectedStatuses.has(status(payment.status))) continue;
    const tracking = payment.metadata?.daily_refund_tracking;
    if ([true, 1, 'true', '1'].includes(tracking)) continue;
    const method = String(payment.payment_method || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    const amount = Number(payment.amount || 0);
    const change = ['cash', 'pos-cash'].includes(method)
      ? Math.max(0, Number(payment.change_amount ?? payment.metadata?.pos_change_returned ?? 0) || 0) : 0;
    const collected = Math.max(0, amount - change);
    const refund = status(payment.status) === 'refunded' ? collected : Math.max(0, Number(payment.refund_amount || 0));
    const net = Math.max(0, collected - refund);
    if (['cash', 'pos-cash'].includes(method)) {
      cash += net;
    }
    else if (['card', 'pos-card', 'credit', 'debit', 'credit-card', 'debit-card'].includes(method)) card += net;
    else if (['ebt', 'pos-ebt', 'ebt-card'].includes(method)) ebt += net;
  }
  const categories = input.categories.map(category => {
    const totalSales = money(categorySales.get(String(category.id)) || 0);
    return { id: category.id, name: category.name, slug: category.slug, total_sales: totalSales, sales_percentage: totalAmount > 0 ? money(totalSales / totalAmount * 100) : 0 };
  });
  return { success: true, message: 'Order counts fetched successfully.', data: {
    business_name: input.businessName, total_orders: input.orders.length, total_orders_amount: money(totalAmount), cancelled_orders: cancelled,
    refunded_orders_amount: money(input.refunds.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0)),
    payouts: money(payouts), cashbacks: money(cashbacks), void_items: voidItems, cash: money(cash), card: money(card), ebt: money(ebt), categories,
    category_subtotal: money(categories.reduce((sum, category) => sum + category.total_sales, 0)),
    category_percentage_total: money(categories.reduce((sum, category) => sum + category.sales_percentage, 0)),
  } };
}
