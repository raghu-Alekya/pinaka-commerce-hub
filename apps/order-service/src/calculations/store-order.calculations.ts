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
  // Coupon application can rewrite line totals, so the original automatic,
  // multipack, and mix-and-match amounts must be retained from POS metadata.
  const representedByLines = Math.max(lineReduction, promotionDiscount + couponDiscount);
  const merchantFeeDiscount = merchantDiscountMinor(feeLines, places);
  const unrepresentedMerchantFee = Math.max(0, merchantFeeDiscount - merchantCouponDiscount);
  return fromMinor(representedByLines + unrepresentedMerchantFee, places);
}

export function sumCouponDiscounts(couponLines: PosCouponLine[] = [], places = 2): number {
  const minor = couponLines.reduce(
    (sum, line) => sum + Math.max(0, toMinor(line?.discount ?? 0, places)),
    0,
  );
  return fromMinor(minor, places);
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

/** Returns [] when no rate is supplied or the computed tax is zero. */
export function calculateTaxLines(input: TaxCalculationInput): PosTaxLine[] {
  const places = input.decimalPlaces ?? 2;
  const rate = Number(input.rate || 0);
  if (rate <= 0) return [];

  const pricesIncludeTax = Boolean(input.pricesIncludeTax);
  const taxableLines = (input.lineItems || []).filter((line) => isTaxableSaleLine(line));
  const rawLineAmounts = taxableLines.map((line) => Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places)));
  const lineBase = rawLineAmounts.reduce((sum, amount) => sum + amount, 0);
  const merchantDiscount = Math.min(merchantDiscountMinor(input.feeLines, places), lineBase);
  const lineAmounts = amountsAfterDiscount(rawLineAmounts, merchantDiscount);
  const feeAmounts = (input.feeLines || [])
    .filter((fee) => !isMerchantDiscountFee(fee)
      && !isPayoutFee(fee)
      && String(fee?.tax_status || 'taxable').toLowerCase() !== 'none')
    .map((fee) => toMinor(fee?.total ?? 0, places));

  const mode = input.calculation || 'item-price';
  const taxMinor = mode === 'item-price'
    ? [...lineAmounts, ...feeAmounts].reduce((sum, amount) => sum + taxOn(amount, rate, pricesIncludeTax), 0)
    : taxOn(
      Math.max(0, [...lineAmounts, ...feeAmounts].reduce((sum, amount) => sum + amount, 0)),
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
 * A merchant_discount fee is not part of the line total. Scale tax that was
 * calculated on the pre-discount price down to the post-discount price.
 */
export function applyMerchantDiscountToStoredTax(
  lines: Array<PosLineItem & { total_tax?: unknown; subtotal_tax?: unknown; taxes?: unknown }>,
  feeLines: PosFeeLine[] | undefined,
  orderTax: { total_tax?: unknown; cart_tax?: unknown; tax_lines?: Array<{ tax_total?: unknown }> },
  places = 2,
): void {
  const taxable = lines.filter((line) => isTaxableSaleLine(line));
  const amounts = taxable.map((line) => Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places)));
  const base = amounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(merchantDiscountMinor(feeLines, places), base);
  if (!discount || !base) return;

  const reduced = amountsAfterDiscount(amounts, discount);
  let oldLineTax = 0;
  const nextTax = taxable.map((line, index) => {
    const oldMinor = Math.max(0, toMinor(line.total_tax ?? 0, places));
    const nextMinor = amounts[index] > 0 ? Math.round((oldMinor * reduced[index]) / amounts[index]) : 0;
    oldLineTax += oldMinor;
    return nextMinor;
  });
  taxable.forEach((line, index) => {
    const oldMinor = Math.max(0, toMinor(line.total_tax ?? 0, places));
    if (!oldMinor) return;
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
  const basisNew = oldLineTax > 0
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
): void {
  const merchandise = lines.filter(isMerchandiseLine);
  const couponMinor = (couponLines || []).reduce((sum, coupon) => {
    if (/^pos-discount(?:-\d+)?$/i.test(String(coupon?.code || '').trim())) return sum;
    return sum + Math.max(0, toMinor(coupon?.discount ?? 0, places));
  }, 0);
  const representedMinor = Math.max(
    0,
    merchandise.reduce((sum, line) => (
      sum + Math.max(
        0,
        toMinor(line.subtotal ?? line.total ?? 0, places) - toMinor(line.total ?? line.subtotal ?? 0, places),
      )
    ), 0),
  );
  const currentAmounts = merchandise.map((line) => Math.max(0, toMinor(line.total ?? line.subtotal ?? 0, places)));
  const base = currentAmounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(0, couponMinor - representedMinor), base);
  if (!discount || !base) return;

  const reducedAmounts = amountsAfterDiscount(currentAmounts, discount);
  let previousTax = 0;
  let nextTaxTotal = 0;
  merchandise.forEach((line, index) => {
    const previousAmount = currentAmounts[index];
    const nextAmount = reducedAmounts[index];
    line.total = fromMinor(nextAmount, places).toFixed(places);
    if (!isTaxableSaleLine(line)) return;

    const oldTax = Math.max(0, toMinor(line.total_tax ?? 0, places));
    const nextTax = previousAmount > 0 ? Math.round((oldTax * nextAmount) / previousAmount) : 0;
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
  const feeTotal = calculateFeeTotal(input.feeLines, places);
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
  const feeMinorTotal = toMinor(calculateFeeTotal(sourceFees, places), places);
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
