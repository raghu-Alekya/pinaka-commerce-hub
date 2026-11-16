import { Inject, Injectable } from '@nestjs/common';
import type { PosFeeLine, PosLineItem } from '../../calculations/store-order.calculations';
import { loyaltyAmountFromMeta, withLoyaltyDiscountFee } from '../../loyalty/loyalty-line';
import { OrderResponsePresenter } from '../../responses/order-response.presenter';
import type { OrderGraph } from './order-update.types';

@Injectable()
export class OrderUpdatePresenter {
  constructor(
    @Inject(OrderResponsePresenter)
    private readonly responses: OrderResponsePresenter,
  ) {}

  present(graph: OrderGraph) {
    const stored = { ...((graph.order.requestPayload || {}) as Record<string, unknown>) };
    const storeOrder = graph.storeOrder;
    delete stored.date_modified;
    delete stored.date_modified_gmt;
    const totalTax = storeOrder?.taxTotal ?? graph.order.taxAmount;
    const sourceLines = (Array.isArray(storeOrder?.lineItems) ? storeOrder.lineItems : stored.line_items) as PosLineItem[] | undefined;
    const feeLines = (Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : stored.fee_lines) as PosFeeLine[] | undefined;
    const metadata = [
      ...(Array.isArray(storeOrder?.metadata) ? storeOrder.metadata : []),
      ...(Array.isArray(storeOrder?.metaData) ? storeOrder.metaData : []),
      ...(Array.isArray(graph.order.metadata) ? graph.order.metadata : []),
      ...(Array.isArray(stored.meta_data) ? stored.meta_data as Array<{ key?: string; value?: unknown }> : []),
    ];
    const redemption = loyaltyAmountFromMeta(metadata);
    const storedTotal = Number(storeOrder?.total ?? graph.order.totalAmount);
    const request = {
      ...stored,
      status: storeOrder?.status || String(graph.order.orderStatus || '').toLowerCase(),
      currency: storeOrder?.currency || stored.currency,
      discount_total: storeOrder?.discountTotal ?? graph.order.discountAmount,
      // Use the stored gross order total for payment/change calculations.
      // Removing tax here made change incorrect (30.00 - 18.37 instead of
      // 30.00 - 20.04 for the order-detail response).
      total: storeOrder?.total ?? graph.order.totalAmount,
      total_tax: totalTax,
      cart_tax: storeOrder?.taxTotal ?? stored.cart_tax,
      line_items: sourceLines,
      coupon_lines: storeOrder?.couponLines ?? stored.coupon_lines,
      fee_lines: withLoyaltyDiscountFee(feeLines, redemption, Number.isFinite(storedTotal) ? storedTotal : 0),
      tax_lines: storeOrder?.taxLines ?? stored.tax_lines,
    };
    const response = this.responses.present(this.responses.profileFor(request), {
      result: {
        order: graph.order,
        items: graph.items,
        storeOrder,
        duplicate: false,
      },
      request,
    });
    const responseMeta = Array.isArray(response?.meta_data) ? response.meta_data : [];
    const storedMeta = [
      ...(Array.isArray(storeOrder?.metadata) ? storeOrder.metadata : []),
      ...(Array.isArray(storeOrder?.metaData) ? storeOrder.metaData : []),
    ];
    const storedValue = (key: string, fallback: unknown) => {
      const value = storedMeta.find((entry: any) => entry?.key === key)?.value;
      return value === undefined || value === null || value === '' ? fallback : value;
    };
    const paymentEntry = [
      ...storedMeta,
      ...(Array.isArray(graph.order.metadata) ? graph.order.metadata : []),
      ...(Array.isArray(stored.meta_data) ? stored.meta_data : []),
    ].find((entry: any) => entry?.key === '_pos_payments');
    const payments = Array.isArray(paymentEntry?.value) ? paymentEntry.value : null;
    let cashReceived = storedValue('pos_cash_received', response.cash_received);
    let changeAmount = storedValue('pos_change_returned', response.change_amount);
    if (payments) {
      let cash = 0;
      let tendered = 0;
      for (const payment of payments) {
        const status = String(payment?.status ?? 'completed').trim().toLowerCase();
        if (!['', 'completed', 'pending', 'voided'].includes(status)) continue;
        const amount = Number(payment?.amount ?? payment?.total ?? payment?.value ?? 0);
        if (!Number.isFinite(amount)) continue;
        const signed = status === 'voided' ? -Math.abs(amount) : Math.max(0, amount);
        tendered += signed;
        const method = String(payment?.method ?? payment?.payment_method ?? payment?.paymentMethod ?? '')
          .trim().toLowerCase().replace(/[\s_]+/g, '-');
        if (method === 'cash' || method === 'pos-cash') cash += signed;
      }
      const total = Number(response.total ?? storeOrder?.total ?? graph.order.totalAmount ?? 0);
      cashReceived = Number(cash.toFixed(2));
      changeAmount = Math.max(0, Number((tendered - total).toFixed(2)));
    }
    const replacementValues: Record<string, unknown> = {
      pos_cash_received: cashReceived,
      pos_change_returned: changeAmount,
    };
    const replacedKeys = new Set<string>();
    response.meta_data = responseMeta.map((entry: any) => {
      const key = String(entry?.key ?? '').trim();
      if (!Object.prototype.hasOwnProperty.call(replacementValues, key)) return entry;
      replacedKeys.add(key);
      return { ...entry, key, value: replacementValues[key] };
    });
    for (const key of Object.keys(replacementValues)) {
      if (!replacedKeys.has(key)) {
        response.meta_data.push({
          id: response.meta_data.length + 1,
          key,
          value: replacementValues[key],
        });
      }
    }
    response.cash_received = replacementValues.pos_cash_received;
    response.change_amount = replacementValues.pos_change_returned;
    return response;
  }
}
