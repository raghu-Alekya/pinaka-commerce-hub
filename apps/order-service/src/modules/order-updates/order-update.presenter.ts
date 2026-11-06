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
    return this.responses.present(this.responses.profileFor(request), {
      result: {
        order: graph.order,
        items: graph.items,
        storeOrder,
        duplicate: false,
      },
      request,
    });
  }
}
