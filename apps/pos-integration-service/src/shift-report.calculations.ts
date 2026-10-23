export type ReportOrder = {
  order_id: string;
  client_order_id: string | null;
  status: string;
  total: number;
  customer_name: string | null;
  payment_method_title: string | null;
  line_items: unknown;
  created_at: Date | string | null;
  refunded: number;
};

export type ReportPayment = {
  id: string;
  order_id: string | null;
  client_order_id: string | null;
  payment_type: string | null;
  payment_method: string | null;
  payment_method_title: string | null;
  amount: number;
  refund_amount: number;
  metadata: Record<string, unknown> | null;
  payment_at: Date | string | null;
  entry_type: string | null;
  is_void: boolean;
  status: string | null;
};

export type SafeDropRow = {
  id: string;
  total: number;
  denominations: unknown;
  note: string;
  time: string;
};

export type VendorPayoutRow = {
  id: string;
  amount: number;
  note: string;
  payment_method: string;
  time: string;
  vendor_name: string;
  service_type: string;
  vendor_id: string;
};

export type CashbackSettings = {
  enabled?: unknown;
  max_cashback?: unknown;
  maxCashback?: unknown;
  tiers?: Array<Record<string, unknown>>;
};

const COMPLETED = new Set(['completed']);
const PARTIAL_OR_REFUNDED = new Set(['partial-refund', 'partially-refunded', 'refunded']);

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function orderStatus(status: string | null | undefined): string {
  return String(status || '').trim().toLowerCase().replace(/^wc-/, '');
}

export function isCompletedOrder(order: ReportOrder): boolean {
  return COMPLETED.has(orderStatus(order.status));
}

export function isPartialOrRefundedOrder(order: ReportOrder): boolean {
  return PARTIAL_OR_REFUNDED.has(orderStatus(order.status));
}

export function formatTimestamp(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function sanitizeText(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\r\n|\r/g, '\n');
}

export function wordpressNumber(value: unknown): number | string {
  if (value == null || value === '') return 0;
  const text = String(value).trim();
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function linesOf(order: ReportOrder): Array<Record<string, unknown>> {
  return Array.isArray(order.line_items) ? order.line_items.filter((line) => line && typeof line === 'object') as Array<Record<string, unknown>> : [];
}

function lineTotal(line: Record<string, unknown>): number {
  const raw = line.total ?? line.total_price ?? line.subtotal ?? 0;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

function lineName(line: Record<string, unknown>): string {
  return String(line.name ?? line.product_name ?? line.productName ?? '');
}

export function paymentChange(payment: ReportPayment): number {
  const metadata = asRecord(payment.metadata);
  const source = asRecord(metadata.source_payload);
  const raw = metadata.pos_change_returned ?? metadata._pos_change_returned ?? metadata.change
    ?? source.pos_change_returned ?? source._pos_change_returned ?? source.change ?? 0;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

export function isSalePayment(payment: ReportPayment): boolean {
  if (payment.is_void) return false;
  if (String(payment.entry_type || 'payment').toLowerCase() !== 'payment') return false;
  if (String(payment.payment_type || 'pos_payment').toLowerCase() === 'vendor_payment') return false;
  const status = String(payment.status || 'completed').toLowerCase();
  return status !== 'failed' && status !== 'cancelled';
}

export function methodIs(payment: ReportPayment, method: string): boolean {
  return String(payment.payment_method || '').trim().toLowerCase() === method;
}

export function netPaymentAmount(payment: ReportPayment): number {
  return Number(payment.amount || 0) - paymentChange(payment);
}

export function getShiftNoOfSales(orders: ReportOrder[]): Array<{ id: string; status: string; date_created: string; total: number; payment_method: string; billing_name: string; line_items: Array<{ name: string; qty: number; total: number; subtotal: number }> }> {
  return orders.filter(isCompletedOrder).map((order) => ({
    id: order.order_id,
    status: orderStatus(order.status),
    date_created: formatTimestamp(order.created_at),
    total: Number(order.total || 0),
    payment_method: order.payment_method_title || '',
    billing_name: order.customer_name || '',
    line_items: linesOf(order).map((line) => ({
      name: lineName(line),
      qty: Number(line.quantity ?? line.qty ?? 0) || 0,
      total: lineTotal(line),
      subtotal: Number(line.subtotal ?? lineTotal(line)) || 0,
    })),
  }));
}

export function getPartialOrderAmounts(orders: ReportOrder[], payments: ReportPayment[]): { total_sales: number; total_sale_amount: number; total_remaining_after_refund: number } {
  const cashByOrder = new Map<string, number>();
  for (const payment of payments) {
    if (!isSalePayment(payment) || !methodIs(payment, 'cash') || !payment.order_id) continue;
    cashByOrder.set(payment.order_id, (cashByOrder.get(payment.order_id) || 0) + netPaymentAmount(payment));
  }

  let totalSales = 0;
  let totalSaleAmount = 0;
  let totalRemainingAfterRefund = 0;
  for (const order of orders) {
    if (!isPartialOrRefundedOrder(order) || !cashByOrder.has(order.order_id)) continue;
    const paymentAmount = cashByOrder.get(order.order_id) || 0;
    const refunded = Number(order.refunded || 0);
    const remainingAfterRefund = Number(order.total || 0) - refunded;
    totalRemainingAfterRefund += refunded;
    totalSaleAmount += Math.min(paymentAmount, remainingAfterRefund);
    totalSales += 1;
  }
  return {
    total_sales: totalSales,
    total_sale_amount: totalSaleAmount,
    total_remaining_after_refund: totalRemainingAfterRefund,
  };
}

function namedLineTotal(orders: ReportOrder[], needle: string): number {
  let total = 0;
  for (const order of orders) {
    if (!isCompletedOrder(order)) continue;
    for (const line of linesOf(order)) {
      if (lineName(line).toLowerCase().includes(needle)) total += lineTotal(line);
    }
  }
  return total || 0;
}

export function shiftCashBackAmount(orders: ReportOrder[]): number {
  return namedLineTotal(orders, 'cashback');
}

export function shiftPayoutAmount(orders: ReportOrder[]): number {
  return namedLineTotal(orders, 'payout');
}

export function cashbackFeeForAmount(amount: number, settings: CashbackSettings | null): number {
  if (!settings || settings.enabled == null || settings.enabled === false || settings.enabled === 0 || settings.enabled === '0' || settings.enabled === '') {
    return 0;
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const max = Number(settings.max_cashback ?? settings.maxCashback ?? 0);
  if (max > 0 && value > max) return 0;
  const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];
  for (const tier of tiers) {
    const from = Number(tier.from ?? tier.fromAmount ?? 0);
    const to = Number(tier.to ?? tier.toAmount ?? 0);
    if (value >= from && value <= to) return Number(tier.fee ?? 0) || 0;
  }
  return 0;
}

export function shiftCashBackFeeAmount(orders: ReportOrder[], settings: CashbackSettings | null): number {
  let total = 0;
  for (const order of orders) {
    if (!isCompletedOrder(order)) continue;
    for (const line of linesOf(order)) {
      if (!lineName(line).toLowerCase().includes('cashback')) continue;
      total += cashbackFeeForAmount(lineTotal(line), settings);
    }
  }
  return total || 0;
}

export function getShiftSalesTotal(payments: ReportPayment[]): number {
  let total = 0;
  for (const payment of payments) {
    if (!isSalePayment(payment) || !methodIs(payment, 'cash')) continue;
    total += netPaymentAmount(payment);
  }
  return roundMoney(total);
}

export function getShiftEbtTotal(payments: ReportPayment[]): number {
  return roundMoney(payments.reduce((sum, payment) => (
    isSalePayment(payment) && methodIs(payment, 'ebt') ? sum + Number(payment.amount || 0) : sum
  ), 0));
}

export function getShiftCardTotal(payments: ReportPayment[]): number {
  return roundMoney(payments.reduce((sum, payment) => (
    isSalePayment(payment) && methodIs(payment, 'card') ? sum + Number(payment.amount || 0) : sum
  ), 0));
}

export function getVendorCashPayouts(payouts: VendorPayoutRow[]): number {
  return roundMoney(payouts.reduce((sum, payout) => (
    payout.payment_method.trim().toLowerCase() === 'cash' ? sum + Number(payout.amount || 0) : sum
  ), 0));
}

function metaValue(line: Record<string, unknown>, key: string): unknown {
  const meta = Array.isArray(line.meta_data) ? line.meta_data : [];
  const match = meta.find((entry) => entry && typeof entry === 'object' && String((entry as { key?: unknown }).key || '').toLowerCase() === key);
  return match && typeof match === 'object' ? (match as { value?: unknown }).value : undefined;
}

function isVoidLine(line: Record<string, unknown>): boolean {
  if (line.void === true || line.is_void === true || line.voided === true) return true;
  if (String(line.status || '').toLowerCase() === 'void') return true;
  const flagged = metaValue(line, 'void');
  return flagged === true || flagged === 1 || flagged === '1' || flagged === 'true';
}

function variationName(line: Record<string, unknown>): string {
  const parent = line.parent_name ?? line.parentName;
  const attributes = line.attributes;
  if (typeof parent === 'string' && parent && attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
    const values = Object.values(attributes as Record<string, unknown>).map((value) => String(value || '')).filter(Boolean);
    if (values.length) return `${parent} - ${values.join(' / ')}`;
  }
  return lineName(line);
}

export function getVoidItems(orders: ReportOrder[], shiftId: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  for (const order of orders) {
    for (const line of linesOf(order)) {
      if (!isVoidLine(line)) continue;
      results.push({
        void_id: String(line.id ?? line.void_id ?? `${order.order_id}-${results.length + 1}`),
        title: String(line.title ?? lineName(line)),
        order_id: String(line.offline_orderid ?? order.client_order_id ?? order.order_id),
        item_id: String(line.item_id ?? line.product_id ?? line.productId ?? ''),
        quantity: String(line.item_qty ?? line.quantity ?? line.qty ?? ''),
        product_name: variationName(line),
        shift_id: String(line.shift_id ?? shiftId),
        timestamp: String(line.timestamp ?? formatTimestamp(order.created_at)),
        date: formatTimestamp(order.created_at),
      });
    }
  }
  return results;
}

export type ShiftReportInput = {
  shiftId: string;
  title: string;
  userId: unknown;
  userName: string;
  assignedStaff: unknown;
  startTime: string;
  endTime: string;
  openingBalance: number;
  closingBalance: number;
  notes: string;
  closingNotes: string;
  shiftStatus: string;
  overShort: number;
  orders: ReportOrder[];
  payments: ReportPayment[];
  safeDrops: SafeDropRow[];
  vendorPayouts: VendorPayoutRow[];
  cashbackSettings: CashbackSettings | null;
};

export function prepareShiftData(input: ShiftReportInput): { report: Record<string, unknown>; tillAmount: number } {
  const sales = getShiftNoOfSales(input.orders);
  let totalSales = sales.length;
  let totalSaleAmount = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const partials = getPartialOrderAmounts(input.orders, input.payments);
  totalSaleAmount += partials.total_sale_amount;
  totalSales += partials.total_sales;

  const cashbackAmount = shiftCashBackAmount(input.orders);
  const cashbackFeeAmount = shiftCashBackFeeAmount(input.orders, input.cashbackSettings);
  const safeDropValue = input.safeDrops.reduce((sum, drop) => sum + Number(drop.total || 0), 0);
  const vendorCash = getVendorCashPayouts(input.vendorPayouts);
  const tillAmount = getShiftSalesTotal(input.payments) - cashbackAmount - vendorCash - partials.total_sale_amount - safeDropValue;
  const voidItems = getVoidItems(input.orders, input.shiftId);

  return {
    tillAmount,
    report: {
      shift_id: input.shiftId,
      title: input.title,
      user_id: wordpressNumber(input.userId),
      user_name: input.userName,
      assigned_staff: wordpressNumber(input.assignedStaff),
      start_time: input.startTime,
      end_time: input.endTime,
      total_sales: totalSales || 0,
      total_sale_amount: roundMoney(totalSaleAmount) || 0,
      till_amount: roundMoney(tillAmount) || 0,
      cashback_amount: roundMoney(cashbackAmount) || 0,
      cashback_fee_amount: roundMoney(cashbackFeeAmount) || 0,
      safe_drop_total: Number(safeDropValue) || 0,
      safe_drops: input.safeDrops,
      vendor_payouts: input.vendorPayouts,
      total_vendor_payments: roundMoney(input.vendorPayouts.reduce((sum, row) => sum + Number(row.amount || 0), 0)) || 0,
      opening_balance: roundMoney(input.openingBalance) || 0,
      ebt_total: getShiftEbtTotal(input.payments) || 0,
      card_total: getShiftCardTotal(input.payments) || 0,
      refund_total: roundMoney(partials.total_remaining_after_refund) || 0,
      payout_total: roundMoney(shiftPayoutAmount(input.orders)) || 0,
      void_items_count: voidItems.length,
      void_items: voidItems,
      closing_balance: roundMoney(input.closingBalance) || 0,
      notes: sanitizeText(input.notes),
      shift_closing_notes: sanitizeText(input.closingNotes),
      shift_status: input.shiftStatus || 'open',
      over_short: Math.floor(Number(input.overShort) || 0),
    },
  };
}
