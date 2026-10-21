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
): number {
  const active = transactions.filter((row) => row.status !== 'INACTIVE');
  const sum = (type: string) => active
    .filter((row) => row.transaction_type === type)
    .reduce((total, row) => total + (asMoney(row.total_sum) ?? 0), 0);
  const cashSales = active.some((row) => row.transaction_type === 'CASH_SALE')
    ? sum('CASH_SALE')
    : orderCash;
  const cashIn = cashSales + [...DRAWER_IN].filter((type) => type !== 'CASH_SALE').reduce((total, type) => total + sum(type), 0);
  const cashOut = [...DRAWER_OUT].reduce((total, type) => total + sum(type), 0);
  return roundMoney(openingBalance + cashIn - cashOut);
}

export function toShiftView(
  shift: ShiftMasterRow,
  meta: ShiftMetaView[],
  transactions: ShiftTransactionView[],
  orderSales: { cash: number; card: number } = { cash: 0, card: 0 },
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
    expected_cash_in_drawer: expectedCashInDrawer(opening, transactions, orderSales.cash),
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
