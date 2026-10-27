import { ShiftStatus } from './entities/pos-shift.entity';

export type RowStatus = 'ACTIVE' | 'INACTIVE';

export interface ShiftMetaInput {
  meta_name: string;
  meta_value: unknown;
  status: RowStatus;
}

export interface ShiftTransactionInput {
  id?: string;
  transaction_type: string;
  total_sum: number;
  json_payload: unknown;
  status: RowStatus;
  created_by?: string | null;
  updated_by?: string | null;
  upsert_by_type?: boolean;
}

export interface ShiftMasterInput {
  merchant_id?: string;
  store_id?: string;
  device_id?: string;
  opening_device_id?: string | null;
  closing_device_id?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  closed_by?: string | null;
  status?: ShiftStatus;
  opening_balance?: number;
  closing_balance?: number | null;
  over_short?: number | null;
  declared_cash?: number | null;
  discrepancy?: number | null;
  opened_at?: Date | null;
  closed_at?: Date | null;
}

export interface ShiftWrite {
  shiftId?: string;
  master: ShiftMasterInput;
  meta: ShiftMetaInput[];
  transactions: ShiftTransactionInput[];
  fields: string[];
}

export interface ShiftMetaView {
  id: string;
  shift_id: string;
  meta_name: string;
  meta_value: unknown;
  status: string;
}

export interface ShiftTransactionView {
  id: string;
  shift_id: string;
  transaction_type: string;
  total_sum: number;
  json_payload: unknown;
  status: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftView {
  id: string;
  merchant_id: string;
  store_id: string;
  device_id: string;
  opening_device_id: string | null;
  closing_device_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  closed_by: string | null;
  status: ShiftStatus;
  opening_balance: number;
  closing_balance: number | null;
  over_short: number | null;
  declared_cash: number | null;
  discrepancy: number | null;
  expected_cash_in_drawer: number;
  opened_at: Date;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  order_sales: { cash: number; card: number };
  meta: ShiftMetaView[];
  transactions: ShiftTransactionView[];
}

export interface ShiftMasterRow {
  id: string;
  merchant_id: string;
  store_id: string;
  device_id: string;
  opening_device_id?: string | null;
  closing_device_id?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  closed_by?: string | null;
  status: ShiftStatus;
  opening_balance: number | string | null;
  closing_balance?: number | string | null;
  over_short?: number | string | null;
  declared_cash?: number | string | null;
  discrepancy?: number | string | null;
  opened_at: Date;
  closed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ShiftAmountRow {
  transaction_type: string;
  total_sum: number | string | null;
  status: string;
}

const DRAWER_IN = new Set(['CASH_SALE', 'PAID_IN']);
const DRAWER_OUT = new Set(['SAFE_DROP', 'PAID_OUT', 'VENDOR_PAYMENT', 'PAYOUT', 'CASHBACK']);

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asMoney(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? roundMoney(amount) : null;
}

export function expectedCashInDrawer(
  openingBalance: number,
  transactions: ShiftAmountRow[],
  orderCash = 0,
  orderPayout = 0,
): number {
  const active = transactions.filter((row) => row.status !== 'INACTIVE');
  const sum = (type: string) => active
    .filter((row) => row.transaction_type === type)
    .reduce((total, row) => total + (asMoney(row.total_sum) ?? 0), 0);
  const cashSales = active.some((row) => row.transaction_type === 'CASH_SALE')
    ? sum('CASH_SALE')
    : orderCash;
  const cashIn = cashSales + [...DRAWER_IN].filter((type) => type !== 'CASH_SALE').reduce((total, type) => total + sum(type), 0);
  // PAYOUT and PAID_OUT rows already leave the drawer. Order payouts are added
  // only when neither row exists, so the same payout is not removed twice.
  const recordedPayout = sum('PAYOUT') + sum('PAID_OUT');
  const payoutOut = Math.abs(recordedPayout) >= 0.005 ? 0 : orderPayout;
  const cashOut = [...DRAWER_OUT].reduce((total, type) => total + sum(type), 0) + payoutOut;
  return roundMoney(openingBalance + cashIn - cashOut);
}

export function toShiftView(
  shift: ShiftMasterRow,
  meta: ShiftMetaView[],
  transactions: ShiftTransactionView[],
  orderSales: { cash: number; card: number } = { cash: 0, card: 0 },
  orderPayout = 0,
): ShiftView {
  const opening = asMoney(shift.opening_balance) ?? 0;
  return {
    id: shift.id,
    merchant_id: shift.merchant_id,
    store_id: shift.store_id,
    device_id: shift.device_id,
    opening_device_id: shift.opening_device_id ?? null,
    closing_device_id: shift.closing_device_id ?? null,
    created_by: shift.created_by ?? null,
    updated_by: shift.updated_by ?? null,
    closed_by: shift.closed_by ?? null,
    status: shift.status,
    opening_balance: opening,
    closing_balance: asMoney(shift.closing_balance),
    over_short: asMoney(shift.over_short),
    declared_cash: asMoney(shift.declared_cash),
    discrepancy: asMoney(shift.discrepancy),
    expected_cash_in_drawer: expectedCashInDrawer(opening, transactions, orderSales.cash, orderPayout),
    opened_at: shift.opened_at,
    closed_at: shift.closed_at ?? null,
    created_at: shift.created_at,
    updated_at: shift.updated_at,
    order_sales: {
      cash: roundMoney(orderSales.cash),
      card: roundMoney(orderSales.card),
    },
    meta,
    transactions: transactions.map((row) => ({
      ...row,
      total_sum: asMoney(row.total_sum) ?? 0,
      created_by: row.created_by ?? null,
      updated_by: row.updated_by ?? null,
    })),
  };
}

function activeMeta(view: ShiftView, name: string): unknown {
  const row = view.meta.find((item) => item.meta_name === name && item.status !== 'INACTIVE');
  return row ? row.meta_value : undefined;
}

function activeSum(view: ShiftView, type: string): number | null {
  const rows = view.transactions.filter((item) => item.transaction_type === type && item.status !== 'INACTIVE');
  if (!rows.length) return null;
  return roundMoney(rows.reduce((total, item) => total + item.total_sum, 0));
}

function metaNumber(view: ShiftView, name: string): number | null {
  const value = activeMeta(view, name);
  if (typeof value === 'number' || typeof value === 'string') return asMoney(value);
  return null;
}

function metaText(view: ShiftView, name: string): string | null {
  const value = activeMeta(view, name);
  if (value == null || value === '') return null;
  return typeof value === 'string' ? value : null;
}

/** Flat fields the store shift list and detail pages already render. */
export function withStoreShiftFields<T extends ShiftView>(view: T): T & Record<string, unknown> {
  const cashSales = activeSum(view, 'CASH_SALE');
  const cardSales = activeSum(view, 'CARD_SALE');
  const paidOut = activeSum(view, 'PAID_OUT');
  const payout = activeSum(view, 'PAYOUT');
  const vendor = activeSum(view, 'VENDOR_PAYMENT');
  const payoutParts = [payout, paidOut, vendor].filter((value): value is number => value != null);
  return {
    ...view,
    openedAt: view.opened_at,
    closedAt: view.closed_at,
    openedByEmployeeId: view.created_by,
    closedByEmployeeId: view.closed_by,
    cashierName: metaText(view, 'cashier_name'),
    openingDeviceId: view.opening_device_id || view.device_id,
    closingDeviceId: view.closing_device_id,
    closed_by_device_id: view.closing_device_id,
    terminalId: view.device_id,
    registerId: metaText(view, 'register_id'),
    openingCash: view.opening_balance,
    closingCashActual: view.closing_balance,
    expectedCashInDrawer: view.expected_cash_in_drawer,
    cashDifference: view.over_short ?? view.discrepancy,
    totalCashSales: cashSales ?? view.order_sales.cash,
    totalCardSales: cardSales ?? view.order_sales.card,
    totalSafeDrops: activeSum(view, 'SAFE_DROP'),
    totalPaidOuts: paidOut,
    total_payouts: payoutParts.length ? roundMoney(payoutParts.reduce((total, value) => total + value, 0)) : null,
    total_cashback: activeSum(view, 'CASHBACK'),
    total_refunds: activeSum(view, 'REFUND'),
    total_ebt_sales: activeSum(view, 'EBT_SALE'),
    total_pay_later: activeSum(view, 'PAY_LATER'),
    total_orders: metaNumber(view, 'total_orders'),
    total_order_sale_amount: metaNumber(view, 'total_order_sale_amount'),
    total_void_items: metaNumber(view, 'total_void_items'),
    total_cancelled_orders: metaNumber(view, 'total_cancelled_orders'),
  };
}
