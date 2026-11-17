import { fromMinor, toMinor } from './store-order.calculations';

export interface CashTender {
  method?: unknown;
  amount?: unknown;
  status?: unknown;
}

/**
 * Change handed back on a cash sale. Payment amounts are the cash and other
 * tenders the POS captured. Change is what those tenders exceed the amount due.
 * A payout is cash leaving the drawer, so it has no customer change.
 */
export function cashChangeReturned(input: {
  orderTotal: unknown;
  payments?: CashTender[];
  cashPaid?: unknown;
  decimalPlaces?: number;
}): { change: number; cashReceived: number } {
  const places = input.decimalPlaces ?? 2;
  const orderMinor = toMinor(input.orderTotal, places);
  if (orderMinor < 0) return { change: 0, cashReceived: 0 };

  const active = (input.payments || []).filter((payment) => {
    const status = String(payment?.status ?? 'completed').trim().toLowerCase();
    return status === '' || status === 'completed' || status === 'pending';
  });
  const cashMinor = active.reduce(
    (sum, payment) => sum + (isCashTender(payment.method) ? Math.max(0, toMinor(payment.amount, places)) : 0),
    0,
  );
  const otherMinor = active.reduce(
    (sum, payment) => sum + (isCashTender(payment.method) ? 0 : Math.max(0, toMinor(payment.amount, places))),
    0,
  );
  const declaredCash = Math.max(0, toMinor(input.cashPaid, places));
  const cashReceived = Math.max(cashMinor, declaredCash);
  if (cashReceived <= 0) return { change: 0, cashReceived: 0 };
  const tendered = (declaredCash > cashMinor ? declaredCash : cashMinor) + otherMinor;
  return {
    change: fromMinor(Math.max(0, tendered - orderMinor), places),
    cashReceived: fromMinor(cashReceived, places),
  };
}

export function isCashTender(method: unknown): boolean {
  const value = String(method ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return value === 'cash' || value === 'pos-cash';
}
