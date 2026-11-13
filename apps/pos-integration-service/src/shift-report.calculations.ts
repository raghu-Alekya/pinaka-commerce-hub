export type ReportOrder = {
  order_id: string;
  client_order_id: string | null;
  status: string;
  total: number;
  customer_name: string | null;
  payment_method_title: string | null;
  line_items: unknown;
  fee_lines: unknown;
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

export type DrawerTransaction = {
  id: string;
  transaction_type: string;
  total_sum: number;
  json_payload: Record<string, unknown> | null;
  status: string;
};

export type CashbackSettings = {
  enabled?: unknown;
  max_cashback?: unknown;
  maxCashback?: unknown;
  tiers?: Array<Record<string, unknown>>;
};

const COMPLETED = new Set(['completed']);
const PARTIAL_OR_REFUNDED = new Set(['partial-refund', 'partially-refunded', 'refunded']);
const EXCLUDED_ORDER_STATUSES = new Set([
  'cancelled', 'canceled', 'failed', 'void', 'voided', 'trash', 'pending', 'on-hold', 'checkout-draft',
]);
const SUCCESSFUL_PAYMENT_STATUSES = new Set([
  '', 'completed', 'paid', 'processing', 'refunded', 'partially-refunded', 'partial-refund',
]);
const CARD_METHODS = new Set(['card', 'pos-card', 'credit', 'debit', 'credit-card', 'debit-card']);

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Daily report totals, including non-void recorded payment modes. */
export function dailyShiftSummary(rows: Array<{ date: string; report: Record<string, unknown>; orders: ReportOrder[]; payments: ReportPayment[] }>) {
  const days = new Map<string, Record<string, number | string>>();
  for (const { date, report, orders, payments } of rows) {
    const day = days.get(date) || { date, total_shifts: 0, total_sales: 0, cash: 0, card: 0, ebt: 0, payouts: 0, void_items: 0, opening_balance: 0, closing_balance: 0, safe_drop: 0, total_orders: 0, cancelled_orders: 0, refund: 0 };
    const add = (key: string, amount: unknown) => { day[key] = Number(day[key] || 0) + (Number(amount) || 0); };
    add('total_shifts', 1);
    for (const payment of payments) {
      const tracking = payment.metadata?.daily_refund_tracking;
      if (payment.is_void || String(payment.entry_type || 'payment').toLowerCase() !== 'payment' || payment.payment_type === 'vendor_payment' || tracking === true || tracking === 'true' || tracking === 1 || tracking === '1') continue;
      const method = tenderKey(payment.payment_method);
      const net = Math.max(0, Number(payment.amount || 0) - paymentChange(payment)) - Math.max(0, Number(payment.refund_amount || 0));
      add('total_sales', net);
      if (isCashMethod(method)) add('cash', net);
      else if (isCardMethod(method)) add('card', net);
      else if (['ebt', 'pos-ebt', 'ebt-card'].includes(method)) add('ebt', net);
    }
    for (const [key, source] of Object.entries({ payouts: 'payout_total', void_items: 'void_items_count', opening_balance: 'opening_balance', closing_balance: 'closing_balance', safe_drop: 'safe_drop_total', refund: 'refund_total' })) add(key, report[source]);
    const counted = new Set<string>();
    for (const order of orders) {
      if (counted.has(order.order_id)) continue;
      counted.add(order.order_id);
      const status = orderStatus(order.status);
      if (['completed', 'refunded', 'partial-refund', 'partially-refunded', 'cancelled', 'canceled'].includes(status)) add('total_orders', 1);
      if (['cancelled', 'canceled'].includes(status)) add('cancelled_orders', 1);
    }
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).map(day => {
    for (const key of ['total_sales', 'cash', 'card', 'ebt', 'payouts', 'opening_balance', 'closing_balance', 'safe_drop', 'refund']) day[key] = roundMoney(Number(day[key]));
    return day;
  });
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

export function tenderKey(method: string | null | undefined): string {
  return String(method || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function isCashMethod(method: string | null | undefined): boolean {
  const value = tenderKey(method);
  return value === 'cash' || value === 'pos-cash';
}

export function isCardMethod(method: string | null | undefined): boolean {
  return CARD_METHODS.has(tenderKey(method));
}

export function isSuccessfulSaleOrder(order: ReportOrder): boolean {
  const status = orderStatus(order.status);
  return status !== '' && !EXCLUDED_ORDER_STATUSES.has(status);
}

export function isSalePayment(payment: ReportPayment): boolean {
  if (payment.is_void) return false;
  if (String(payment.entry_type || 'payment').toLowerCase() !== 'payment') return false;
  if (String(payment.payment_type || 'pos_payment').toLowerCase() === 'vendor_payment') return false;
  const metadata = asRecord(payment.metadata);
  const tracking = metadata.daily_refund_tracking;
  if (tracking === true || tracking === 'true' || tracking === 1 || tracking === '1') return false;
  const status = String(payment.status || 'completed').trim().toLowerCase();
  return SUCCESSFUL_PAYMENT_STATUSES.has(status);
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
  return roundMoney(payouts.reduce((sum, payout) => {
    const method = tenderKey(payout.payment_method);
    const cash = !method || isCashMethod(payout.payment_method);
    return cash ? sum + Number(payout.amount || 0) : sum;
  }, 0));
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
  openingSafeCash?: number;
  closingBalance: number;
  notes: string;
  closingNotes: string;
  shiftStatus: string;
  overShort: number;
  openedAt?: Date | string | null;
  orders: ReportOrder[];
  payments: ReportPayment[];
  safeDrops: SafeDropRow[];
  vendorPayouts: VendorPayoutRow[];
  cashbackSettings: CashbackSettings | null;
  drawerTransactions?: DrawerTransaction[];
};

function activeDrawer(rows: DrawerTransaction[] | undefined, type: string): DrawerTransaction[] {
  return (rows || []).filter((row) => row.status !== 'INACTIVE' && row.transaction_type === type);
}

function sumDrawer(rows: DrawerTransaction[]): number {
  return rows.reduce((total, row) => total + Number(row.total_sum || 0), 0);
}

function drawerMethod(row: DrawerTransaction): string {
  const payload = row.json_payload || {};
  return tenderKey(String(payload.payment_method ?? payload.method ?? payload.tender ?? ''));
}

function feesOf(order: ReportOrder): Array<Record<string, unknown>> {
  return Array.isArray(order.fee_lines) ? order.fee_lines.filter((fee) => fee && typeof fee === 'object') as Array<Record<string, unknown>> : [];
}

function payoutOnOrder(order: ReportOrder): number {
  const feeTotal = feesOf(order).reduce((total, fee) => {
    const name = String(fee.name ?? fee.fee_name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return name === 'payout' || name.startsWith('payout_') ? total + Math.abs(lineTotal(fee)) : total;
  }, 0);
  if (feeTotal > 0) return feeTotal;
  return linesOf(order).reduce((total, line) => (
    lineName(line).toLowerCase().includes('payout') ? total + Math.abs(lineTotal(line)) : total
  ), 0);
}

/** Payout cash that left the drawer without a cash tender, so it is not already inside cash sales. */
export function cashPayoutOutsideTender(orders: ReportOrder[], cashPayments: ReportPayment[]): number {
  const total = orders.reduce((sum, order) => {
    const payout = payoutOnOrder(order);
    if (!payout) return sum;
    const netCash = cashPayments
      .filter((payment) => payment.order_id === order.order_id)
      .reduce((cash, payment) => cash + Number(payment.amount || 0) - paymentChange(payment) - Number(payment.refund_amount || 0), 0);
    return Math.abs(netCash) < 0.005 ? sum + payout : sum;
  }, 0);
  return roundMoney(total);
}

/** Same payout figure the till removes when the shift has no PAYOUT or PAID_OUT transaction. */
export function shiftCashPayoutOutsideTender(orders: ReportOrder[], payments: ReportPayment[]): number {
  const orderById = new Map(orders.map((order) => [order.order_id, order]));
  const included = payments.filter((payment) => {
    if (!isSalePayment(payment)) return false;
    if (!isCashMethod(payment.payment_method) && !isCardMethod(payment.payment_method)) return false;
    if (!payment.order_id) return true;
    const order = orderById.get(payment.order_id);
    return !order || isSuccessfulSaleOrder(order);
  });
  const cashPayments = included.filter((payment) => isCashMethod(payment.payment_method));
  const saleOrderIds = new Set(included.map((payment) => payment.order_id).filter((id): id is string => Boolean(id)));
  return cashPayoutOutsideTender(orders.filter((order) => saleOrderIds.has(order.order_id)), cashPayments);
}

function lineLabel(line: Record<string, unknown>): string {
  return lineName(line).trim().toLowerCase().replace(/[\s-]+/g, ' ');
}

function isCashbackFeeLine(line: Record<string, unknown>): boolean {
  const name = lineLabel(line);
  return name === 'cashback fee' || name.startsWith('cashback fee ');
}

function isCashbackPrincipalLine(line: Record<string, unknown>): boolean {
  if (isCashbackFeeLine(line)) return false;
  const name = lineLabel(line);
  return name === 'cashback' || name === 'cashback amount';
}

function cashbackOnOrders(orders: ReportOrder[]): number {
  return orders.reduce((total, order) => total + linesOf(order).reduce((lineTotalAmount, line) => (
    isCashbackPrincipalLine(line) ? lineTotalAmount + Math.abs(lineTotal(line)) : lineTotalAmount
  ), 0), 0);
}

function cashbackFeeOnOrders(orders: ReportOrder[], settings: CashbackSettings | null): number {
  let total = 0;
  for (const order of orders) {
    const lines = linesOf(order);
    const storedFee = lines.reduce((feeTotal, line) => (
      isCashbackFeeLine(line) ? feeTotal + Math.abs(lineTotal(line)) : feeTotal
    ), 0);
    // A stored "Cashback Fee" line is already part of the cash or card tender.
    if (storedFee > 0) continue;
    for (const line of lines) {
      if (!isCashbackPrincipalLine(line)) continue;
      total += cashbackFeeForAmount(Math.abs(lineTotal(line)), settings);
    }
  }
  return total;
}

function reportEpoch(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

/** A safe drop recorded with the shift open is not cash removed from an already open drawer. */
function safeDropReducesTill(drop: SafeDropRow, openedAt: Date | string | null | undefined): boolean {
  const dropTime = reportEpoch(drop.time);
  const openTime = reportEpoch(openedAt);
  if (dropTime == null || openTime == null) return true;
  return dropTime > openTime + 15_000;
}

/**
 * Sales and drawer totals for one shift.
 *
 * total_sale_amount = net cash tender + net card tender + cashback fee - payout
 * net tender        = captured amount - refund on that tender - change (cash only)
 *
 * till_amount = opening balance
 *             + cash captured - cash change
 *             - cash refunds
 *             - cashback principal handed to the customer
 *             - payouts, paid-outs, cash vendor payments, and safe drops made after the shift opens
 *             + paid-ins
 * A safe drop recorded at shift open is reported, but it is not removed from the till.
 * A stored "Cashback Fee" line is already inside the cash or card tender, so it is not added again.
 */
export function prepareShiftData(input: ShiftReportInput): { report: Record<string, unknown>; tillAmount: number } {
  const orders = new Map(input.orders.map((order) => [order.order_id, order]));
  const included = input.payments.filter((payment) => {
    if (!isSalePayment(payment)) return false;
    if (!isCashMethod(payment.payment_method) && !isCardMethod(payment.payment_method)) return false;
    if (!payment.order_id) return true;
    const order = orders.get(payment.order_id);
    return !order || isSuccessfulSaleOrder(order);
  });
  const cashPayments = included.filter((payment) => isCashMethod(payment.payment_method));
  const cardPayments = included.filter((payment) => isCardMethod(payment.payment_method));
  const paymentCashRefund = cashPayments.reduce((total, payment) => total + Number(payment.refund_amount || 0), 0);
  const paymentCardRefund = cardPayments.reduce((total, payment) => total + Number(payment.refund_amount || 0), 0);

  let cashIn = cashPayments.reduce((total, payment) => total + Number(payment.amount || 0) - paymentChange(payment), 0);
  let cardIn = cardPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  if (!cashPayments.length) cashIn = sumDrawer(activeDrawer(input.drawerTransactions, 'CASH_SALE'));
  if (!cardPayments.length) cardIn = sumDrawer(activeDrawer(input.drawerTransactions, 'CARD_SALE'));

  let cashRefund = paymentCashRefund;
  let cardRefund = paymentCardRefund;
  if (paymentCashRefund + paymentCardRefund === 0) {
    for (const row of activeDrawer(input.drawerTransactions, 'REFUND')) {
      const method = drawerMethod(row);
      const amount = Number(row.total_sum || 0);
      if (isCardMethod(method)) cardRefund += amount;
      else if (!method || isCashMethod(method)) cashRefund += amount;
    }
  }

  const saleOrderIds = new Set(included.map((payment) => payment.order_id).filter((id): id is string => Boolean(id)));
  const saleOrders = input.orders.filter((order) => saleOrderIds.has(order.order_id));
  const cashbackRows = activeDrawer(input.drawerTransactions, 'CASHBACK');
  const cashbackAmount = cashbackRows.length ? sumDrawer(cashbackRows) : cashbackOnOrders(saleOrders);
  const cashbackFeeAmount = cashbackFeeOnOrders(saleOrders, input.cashbackSettings);

  const paidOut = sumDrawer(activeDrawer(input.drawerTransactions, 'PAID_OUT'));
  const payoutTransactions = sumDrawer(activeDrawer(input.drawerTransactions, 'PAYOUT'));
  const paidIn = sumDrawer(activeDrawer(input.drawerTransactions, 'PAID_IN'));
  const recognizedOrderPayout = saleOrders.reduce((total, order) => total + payoutOnOrder(order), 0);
  const orderPayoutSubtracted = paidOut || payoutTransactions ? 0 : cashPayoutOutsideTender(saleOrders, cashPayments);

  const safeDropValue = input.safeDrops.reduce((sum, drop) => sum + Number(drop.total || 0), 0);
  const safeDropInTill = input.safeDrops.reduce((sum, drop) => (
    safeDropReducesTill(drop, input.openedAt) ? sum + Number(drop.total || 0) : sum
  ), 0);
  const vendorCash = getVendorCashPayouts(input.vendorPayouts);
  const cashNet = cashIn - cashRefund;
  const cardNet = cardIn - cardRefund;
  const payoutAmount = recognizedOrderPayout + paidOut + payoutTransactions;
  const totalSaleAmount = cashNet + cardNet + cashbackFeeAmount - payoutAmount;
  const tillAmount = Number(input.openingBalance || 0)
    + cashIn
    - cashRefund
    - cashbackAmount
    - orderPayoutSubtracted
    - paidOut
    - payoutTransactions
    - vendorCash
    - safeDropInTill
    + paidIn;
  const saleCount = new Set(included.map((payment) => payment.order_id || payment.id)).size;
  const voidItems = getVoidItems(input.orders, input.shiftId);
  const opening_balance = Number(input.openingBalance || 0) + Number(input.openingSafeCash || 0)
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
      total_sales: saleCount || 0,
      total_sale_amount: roundMoney(totalSaleAmount) || 0,
      till_amount: roundMoney(tillAmount) || 0,
      cashback_amount: roundMoney(cashbackAmount) || 0,
      cashback_fee_amount: roundMoney(cashbackFeeAmount) || 0,
      safe_drop_total: Number(safeDropValue) || 0,
      safe_drops: input.safeDrops,
      vendor_payouts: input.vendorPayouts,
      opening_safe_cash: roundMoney(Number(input.openingSafeCash) || 0),
      total_vendor_payments: roundMoney(input.vendorPayouts.reduce((sum, row) => sum + Number(row.amount || 0), 0)) || 0,
      opening_balance: opening_balance || 0,
      ebt_total: getShiftEbtTotal(input.payments) || 0,
      card_total: getShiftCardTotal(input.payments) || 0,
      refund_total: roundMoney(cashRefund + cardRefund) || 0,
      payout_total: payoutAmount ? -roundMoney(payoutAmount) : 0,
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
