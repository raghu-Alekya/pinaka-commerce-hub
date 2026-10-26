import { BadRequestException, Injectable } from '@nestjs/common';
import { listOrderTax } from '../calculations/store-order.calculations';
import type { OrderEntity } from '../entities/order.entity';
import { PaymentStatus } from '../entities/order.entity';
import type { OrderItemEntity } from '../entities/order-item.entity';
import type { StoreOrderEntity } from '../entities/store-order.entity';

export interface OrderListRequest {
  page?: string;
  perPage?: string;
  status?: string;
  createdVia?: string;
  storeId?: string;
}

@Injectable()
export class OrderListPresenter {
  criteria(request: OrderListRequest) {
    const page = this.pageNumber(request.page, 1, 'page');
    const perPage = this.pageNumber(request.perPage, 10, 'per_page');
    if (perPage > 100) throw new BadRequestException('per_page cannot be greater than 100');
    return {
      storeId: request.storeId?.trim() || undefined,
      page,
      perPage,
      statuses: this.statuses(request.status),
      createdVia: request.createdVia?.trim() || undefined,
      orderBy: 'modified' as const,
    };
  }

  present(
    page: number,
    perPage: number,
    total: number,
    rows: Array<{
      order: OrderEntity;
      storeOrder: StoreOrderEntity | null;
      items: OrderItemEntity[];
      products: Map<string, unknown>;
      refunds: Array<{ amount: unknown; metadata: Record<string, unknown> | null }>;
      effectiveStatus?: string;
    }>,
  ) {
    return {
      order_total_count: total,
      page,
      per_page: perPage,
      orders_data: rows.map((row) => this.orderRow(row)),
    };
  }

  private orderRow(row: {
    order: OrderEntity;
    storeOrder: StoreOrderEntity | null;
    items: OrderItemEntity[];
    products: Map<string, unknown>;
    refunds: Array<{ amount: unknown; metadata: Record<string, unknown> | null }>;
    effectiveStatus?: string;
  }) {
    const { order, storeOrder } = row;
    const request = (order.requestPayload || {}) as Record<string, unknown>;
    const timeZone = storeOrder?.timezone || 'UTC';
    const currency = String(storeOrder?.currency || request.currency || 'USD').toUpperCase();
    const status = this.displayStatus(row.effectiveStatus || storeOrder?.status || this.statusFromOrder(order));
    const paid = order.paymentStatus === PaymentStatus.PAID || Boolean(storeOrder?.setPaid) || Boolean(request.date_paid);
    const paidAt = this.paidStamp(request, order.createdAt, timeZone, paid);
    const orderNumber = Number(String(order.orderNumber || '').replace(/\D/g, ''));
    const tax = listOrderTax({
      tax: storeOrder?.taxTotal ?? request.total_tax ?? order.taxAmount,
      lineItems: Array.isArray(storeOrder?.lineItems) ? storeOrder.lineItems : undefined,
      feeLines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : undefined,
      taxLines: Array.isArray(storeOrder?.taxLines) ? storeOrder.taxLines : undefined,
    });
    const total = this.money(listOrderTotal({
      total: storeOrder?.total ?? order.totalAmount,
      tax,
      taxLines: Array.isArray(storeOrder?.taxLines) ? storeOrder.taxLines : undefined,
      couponDiscount: coupons.reduce(
        (sum, line) => sum + Number((line as { discount?: unknown })?.discount || 0),
        0,
      ),
      lineItems: Array.isArray(storeOrder?.lineItems) ? storeOrder.lineItems : undefined,
      feeLines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : undefined,
      shippingTotal: request.shipping_total ?? request.shippingTotal,
      tip: storeOrder?.tipAmount ?? order.tipAmount,
    }));
    const totalNumber = Number(total);
    const refundTotal = this.refundTotal(row.refunds, status);
    const refundedItemIds = new Set(row.refunds.flatMap((refund) => {
      const lines = refund.metadata?.line_items;
      return Array.isArray(lines)
        ? lines.map((line: any) => String(line?.order_item_id ?? '')).filter(Boolean)
        : [];
    }));
    const fullyRefunded = status.toLowerCase() === 'refunded';
    const lineItems = this.lineItems(
      storeOrder?.lineItems,
      row.items,
      order.storeId,
      row.products,
      refundedItemIds,
      fullyRefunded,
    );
    const remainingTax = status.toLowerCase() === 'partially refunded'
      ? Math.max(0, tax - this.refundedItemsTax(lineItems, row.refunds))
      : tax;
    return {
      id: this.clientOrderId(order, storeOrder),
      woo_order_id: Number.isSafeInteger(orderNumber) && orderNumber > 0 ? orderNumber : null,
      status,
      date_created: this.listDate(order.createdAt, timeZone),
      date_modified: this.listDate(order.updatedAt, timeZone),
      total,
      discount_total: this.money(storeOrder?.discountTotal ?? order.discountAmount),
      discount_tax: this.taxText(request.discount_tax),
      total_tax: this.taxText(remainingTax),
      change_amount: this.money(this.metaValue(order, 'pos_change_returned')),
      cash_received: this.money(this.metaValue(order, 'pos_cash_received')),
      created_via: String(request.created_via || this.metaValue(order, 'order_created_via') || 'rest-api'),
      author: String(storeOrder?.placedBy || this.metaValue(order, 'pos_placed_by') || ''),
      currency,
      currency_symbol: this.currencySymbol(currency),
      date_completed: request.date_completed
        ? String(request.date_completed)
        : (status === 'Completed' ? paidAt : null),
      date_paid: request.date_paid ? String(request.date_paid) : paidAt,
      coupon_lines: Array.isArray(storeOrder?.couponLines) ? storeOrder.couponLines : [],
      line_items: lineItems,
      fee_lines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : [],
      tax_lines: Array.isArray(storeOrder?.taxLines) ? storeOrder.taxLines : [],
      refund_order_total: totalNumber,
      refund_total: this.round(refundTotal),
      net_payment: this.round(Math.max(0, totalNumber - refundTotal)),
    };
  }

  private lineItems(
    stored: unknown[] | undefined,
    items: OrderItemEntity[],
    storeId: string,
    products: Map<string, unknown>,
    refundedItemIds: Set<string>,
    fullyRefunded: boolean,
  ) {
    const lines = Array.isArray(stored) && stored.length
      ? stored
      : items.map((item) => ({
          id: item.id,
          name: item.productName,
          product_id: item.productId,
          quantity: item.quantity,
          subtotal: item.totalPrice,
          total: item.totalPrice,
          meta_data: item.modifiers || [],
        }));
    return lines.map((line, index) => this.lineItem(
      line,
      items[index],
      storeId,
      products,
      refundedItemIds,
      fullyRefunded,
    ));
  }

  private refundTotal(
    refunds: Array<{ amount: unknown; metadata: Record<string, unknown> | null }>,
    status: string,
  ): number {
    if (status.toLowerCase() !== 'partially refunded') {
      return refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
    }

    const seen = new Set<string>();
    return refunds.reduce((sum, refund, index) => {
      const metadata = refund.metadata || {};
      const refundId = String(metadata.refund_id ?? metadata.legacy_refund_id ?? `row-${index}`);
      if (seen.has(refundId)) return sum;
      seen.add(refundId);

      const lines = Array.isArray(metadata.line_items) ? metadata.line_items : [];
      const requestedTotal = lines.reduce((lineSum, line: any) => (
        lineSum + Number(line?.refundable_amount ?? line?.refund_total ?? 0)
      ), 0);
      return sum + (requestedTotal > 0 ? requestedTotal : Number(refund.amount || 0));
    }, 0);
  }

  private refundedItemsTax(
    storedLines: unknown[] | undefined,
    refunds: Array<{ amount: unknown; metadata: Record<string, unknown> | null }>,
  ): number {
    if (!Array.isArray(storedLines) || !storedLines.length) return 0;

    const seenRefunds = new Set<string>();
    const refundedQuantities = new Map<string, number>();
    refunds.forEach((refund, refundIndex) => {
      const metadata = refund.metadata || {};
      const refundId = String(metadata.refund_id ?? metadata.legacy_refund_id ?? `row-${refundIndex}`);
      if (seenRefunds.has(refundId)) return;
      seenRefunds.add(refundId);

      const refundedLines = Array.isArray(metadata.line_items) ? metadata.line_items : [];
      refundedLines.forEach((line: any) => {
        const itemId = String(line?.order_item_id ?? '').trim();
        if (!itemId) return;
        const quantity = Number(line?.quantity);
        const previous = refundedQuantities.get(itemId) || 0;
        refundedQuantities.set(
          itemId,
          Number.isFinite(quantity) && quantity > 0 ? previous + quantity : Number.POSITIVE_INFINITY,
        );
      });
    });

    const refundedTax = storedLines.reduce((sum, line: any) => {
      const refundedQuantity = refundedQuantities.get(String(line?.id ?? ''));
      if (refundedQuantity === undefined) return sum;
      const lineQuantity = Number(line?.quantity);
      const quantity = Number.isFinite(lineQuantity) && lineQuantity > 0 ? lineQuantity : 1;
      const storedTax = Number(line?.total_tax);
      const lineTax = Number.isFinite(storedTax)
        ? storedTax
        : (Array.isArray(line?.taxes)
          ? line.taxes.reduce((taxSum: number, entry: any) => taxSum + Number(entry?.total || 0), 0)
          : 0);
      return sum + lineTax * Math.min(1, refundedQuantity / quantity);
    }, 0);
    return this.round(refundedTax);
  }

  private lineItem(
    line: any,
    fallback: OrderItemEntity | undefined,
    storeId: string,
    products: Map<string, unknown>,
    refundedItemIds: Set<string>,
    fullyRefunded: boolean,
  ) {
    const productId = Number(line?.product_id ?? line?.productId ?? fallback?.productId);
    const productKey = String(line?.product_id ?? line?.productId ?? fallback?.productId ?? '');
    return {
      id: line?.id ?? fallback?.id ?? null,
      name: String(line?.name ?? line?.productName ?? fallback?.productName ?? ''),
      product_id: Number.isSafeInteger(productId) ? productId : (line?.product_id ?? line?.productId ?? fallback?.productId ?? null),
      variation_id: Number(line?.variation_id || 0),
      quantity: Number(line?.quantity ?? fallback?.quantity ?? 0),
      tax_class: String(line?.tax_class || ''),
      subtotal: line?.subtotal !== undefined ? String(line.subtotal) : this.money(fallback?.totalPrice),
      subtotal_tax: line?.subtotal_tax !== undefined ? String(line.subtotal_tax) : '0',
      total: line?.total !== undefined ? String(line.total) : this.money(fallback?.totalPrice),
      total_tax: line?.total_tax !== undefined ? String(line.total_tax) : '0',
      taxes: line?.taxes ?? [],
      meta_data: Array.isArray(line?.meta_data)
        ? line.meta_data
        : (Array.isArray(fallback?.modifiers) ? fallback.modifiers : []),
      is_refund_item: fullyRefunded
        ? false
        : refundedItemIds.has(String(line?.id ?? fallback?.id ?? '')),
      product_data: line?.product_data ?? products.get(`${storeId}:${productKey}`) ?? null,
    };
  }

  private statuses(value?: string): string[] {
    if (!value?.trim()) return [];
    const statuses = value.split(',').map((status) => {
      const normalized = status.trim().toLowerCase().replace(/[\s_]+/g, '-');
      return normalized === 'canceled' ? 'cancelled' : normalized;
    }).filter(Boolean);
    return statuses.some((status) => status === 'all' || status === 'any')
      ? []
      : [...new Set(statuses)];
  }

  private pageNumber(value: string | undefined, fallback: number, name: string): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${name} must be a whole number greater than 0`);
    }
    return parsed;
  }

  private statusFromOrder(order: OrderEntity): string {
    switch (String(order.orderStatus).toUpperCase()) {
      case 'CANCELLED':
        return 'cancelled';
      case 'COMPLETED':
        return 'completed';
      case 'PARTIAL_REFUND':
        return 'partial-refund';
      case 'REFUNDED':
        return 'refunded';
      default:
        return 'processing';
    }
  }

  private displayStatus(status: string): string {
    const normalized = status.trim().toLowerCase();
    switch (normalized) {
      case 'on-hold':
      case 'onhold':
        return 'On-hold';
      case 'cancelled':
        return 'Cancelled';
      case 'partial-refund':
      case 'partially-refunded':
        return 'Partially Refunded';
      default:
        return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Processing';
    }
  }

  private clientOrderId(order: OrderEntity, storeOrder: StoreOrderEntity | null): string | number | null {
    const request = (order.requestPayload || {}) as { meta_data?: Array<{ key?: string; value?: unknown }> };
    const fromPayload = Array.isArray(request.meta_data)
      ? request.meta_data.find((entry) => entry?.key === '_pos_client_order_id')?.value
      : undefined;
    const raw = storeOrder?.clientOrderId || order.clientOrderId || this.metaValue(order, '_pos_client_order_id') || fromPayload;
    const value = String(raw ?? '').trim();
    if (!value) return null;
    if (/^\d+$/.test(value) && !value.startsWith('0') && Number.isSafeInteger(Number(value))) {
      return Number(value);
    }
    return value;
  }

  private metaValue(order: OrderEntity, key: string): string {
    const metadata = Array.isArray(order.metadata) ? order.metadata : [];
    const value = metadata.find((entry) => entry?.key === key)?.value;
    return value === undefined || value === null ? '' : String(value);
  }

  private paidStamp(request: Record<string, unknown>, createdAt: Date, timeZone: string, paid: boolean): string | null {
    if (!paid) return null;
    if (request.date_paid) return String(request.date_paid);
    return `${this.listDate(createdAt, timeZone).replace(' ', 'T')}.000000`;
  }

  private money(value: unknown): string {
    return Number(value || 0).toFixed(2);
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private taxText(value: unknown): string {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount === 0) return '0';
    return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  private currencySymbol(currency: string): string {
    switch (currency.toUpperCase()) {
      case 'EUR':
        return '€';
      case 'GBP':
        return '£';
      case 'INR':
        return '₹';
      default:
        return '$';
    }
  }

  private listDate(value: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '00';
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }
}
