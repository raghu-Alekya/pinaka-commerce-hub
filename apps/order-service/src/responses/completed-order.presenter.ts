import { BadRequestException, Injectable } from '@nestjs/common';
import { isMerchandiseLine, listOrderTax, listOrderTotal } from '../calculations/store-order.calculations';
import type { OrderEntity } from '../entities/order.entity';
import type { OrderItemEntity } from '../entities/order-item.entity';
import type { StoreOrderEntity } from '../entities/store-order.entity';

export interface CompletedOrderListRequest {
  page?: string;
  perPage?: string;
  author?: string;
  after?: string;
  before?: string;
  createdVia?: string;
  merchantId?: string;
  storeId?: string;
}

type CompletedOrderRow = {
  order: OrderEntity;
  storeOrder: StoreOrderEntity | null;
  items: OrderItemEntity[];
  products: Map<string, unknown>;
  refunds?: Array<{ amount: unknown; metadata: Record<string, any> | null }>;
  effectiveStatus?: string;
};

@Injectable()
export class CompletedOrderPresenter {
  criteria(request: CompletedOrderListRequest) {
    const merchantId = request.merchantId?.trim();
    const storeId = request.storeId?.trim();
    if (!merchantId) throw new BadRequestException('x-merchant-id header is required');
    if (!storeId) throw new BadRequestException('x-store-id header is required');
    const page = this.positiveInteger(request.page, 1, 'page');
    const perPage = this.positiveInteger(request.perPage, 100, 'per_page');
    if (perPage > 100) throw new BadRequestException('per_page cannot be greater than 100');
    const after = this.dateBoundary(request.after, false, 'after');
    const before = this.dateBoundary(request.before, true, 'before');
    if (after && before && after > before) {
      throw new BadRequestException('after must be earlier than or equal to before');
    }
    return {
      page,
      perPage,
      merchantId,
      storeId,
      statuses: ['completed', 'partial-refund'],
      createdVia: request.createdVia?.trim() || undefined,
      author: request.author?.trim() || undefined,
      after,
      before,
      orderBy: 'modified' as const,
    };
  }

  present(page: number, perPage: number, total: number, rows: CompletedOrderRow[]) {
    return {
      order_total_count: total,
      page,
      per_page: perPage,
      orders_data: rows.map((row) => this.order(row)),
    };
  }

  private order({ order, storeOrder, items, products, refunds = [], effectiveStatus }: CompletedOrderRow) {
    const request = (order.requestPayload || {}) as Record<string, any>;
    const timezone = storeOrder?.timezone || 'UTC';
    const currency = String(storeOrder?.currency || request.currency || 'USD').toUpperCase();
    const payments = Array.isArray(storeOrder?.payments)
      ? storeOrder.payments
      : (Array.isArray(request.payments) ? request.payments : []);
    const id = this.orderId(order);
    const clientOrderId = this.clientOrderId(order, storeOrder) ?? id;
    const originalItemsTax = this.decimal(listOrderTax({
      tax: storeOrder?.taxTotal ?? request.total_tax ?? order.taxAmount,
      lineItems: Array.isArray(storeOrder?.lineItems) ? storeOrder.lineItems : undefined,
      feeLines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : undefined,
      taxLines: Array.isArray(storeOrder?.taxLines) ? storeOrder.taxLines : undefined,
    }));
    const coupons = Array.isArray(storeOrder?.couponLines) ? storeOrder.couponLines : [];
    const originalGrossTotal = listOrderTotal({
      total: storeOrder?.total ?? order.totalAmount,
      tax: originalItemsTax,
      taxLines: Array.isArray(storeOrder?.taxLines) ? storeOrder.taxLines : undefined,
      couponDiscount: coupons.reduce((sum, line: any) => sum + Number(line?.discount || 0), 0),
      lineItems: Array.isArray(storeOrder?.lineItems) ? storeOrder.lineItems : undefined,
      feeLines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : undefined,
      shippingTotal: request.shipping_total ?? request.shippingTotal,
      tip: storeOrder?.tipAmount ?? order.tipAmount,
    });
    const itemsTax = this.money(effectiveStatus === 'partial-refund'
      ? Math.max(0, Number(originalItemsTax) - this.refundedItemsTax(storeOrder?.lineItems, items, refunds))
      : originalItemsTax);
    const createdVia = String(request.created_via || this.metaValue(order, 'order_created_via') || 'rest-api');
    const lineItems = this.lineItems(
      storeOrder?.lineItems,
      items,
      order.storeId,
      products,
      refunds,
      Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : (request.fee_lines || []),
      coupons,
      Number(itemsTax),
    );
    // Keep the order-level tax aligned with the total-orders API. Item taxes
    // may be redistributed for presentation, but they must not replace the
    // authoritative tax stored against the order.
    // total-orders is authoritative for the order total. Per-item discount and
    // tax distribution is presentation-only and must not rewrite this value.
    const totalNumber = originalGrossTotal;
    const total = this.money(totalNumber);
    const amount = this.money(Math.max(0, totalNumber - Number(itemsTax)));
    const paymentMethod = String(storeOrder?.paymentMethod || request.payment_method || order.paymentMethod || '').toLowerCase();
    const cashReceived = Number(this.metaValue(order, 'pos_cash_received') || 0);
    const storedChange = Number(this.metaValue(order, 'pos_change_returned') || 0);
    const calculatedChange = paymentMethod.includes('cash') ? Math.max(0, cashReceived - totalNumber) : 0;
    return {
      id,
      order_id: clientOrderId,
      status: effectiveStatus === 'partial-refund' ? 'Partially Refunded' : 'completed',
      date: this.displayDate(order.createdAt, timezone),
      date_modified: this.displayDate(order.updatedAt, timezone),
      currency,
      amount,
      items_tax: itemsTax,
      total,
      transaction_id: payments.map((payment: any) => payment?.transaction_id ?? payment?.payment_id ?? payment?.id)
        .filter((value: unknown) => value !== undefined && value !== null && value !== '').join(','),
      payment_method: paymentMethod,
      change_amount: this.money(Math.max(storedChange, calculatedChange)),
      cash_received: this.money(cashReceived),
      discount: Number(storeOrder?.discountTotal ?? order.discountAmount ?? 0) || 0,
      order_type: String(request.order_type || this.metaValue(order, '_order_type') || (createdVia === 'rest-api' ? 'Shop Order' : createdVia)),
      author: String(storeOrder?.placedBy || this.metaValue(order, '_wc_order_created_by') || this.metaValue(order, 'pos_placed_by') || request.author || ''),
      currency_symbol: String(request.currency_symbol || this.currencySymbol(currency)),
      date_completed: request.date_completed || this.isoDate(order.updatedAt),
      date_paid: request.date_paid || this.isoDate(order.createdAt),
      number: String(id),
      coupon_lines: Array.isArray(storeOrder?.couponLines) ? storeOrder.couponLines : (request.coupon_lines || []),
      line_items: lineItems,
      fee_lines: Array.isArray(storeOrder?.feeLines) ? storeOrder.feeLines : (request.fee_lines || []),
      payments,
    };
  }

  private lineItems(
    stored: unknown[] | undefined,
    items: OrderItemEntity[],
    storeId: string,
    products: Map<string, unknown>,
    refunds: Array<{ metadata: Record<string, any> | null }>,
    feeLines: any[],
    couponLines: any[],
    authoritativeTax: number,
  ) {
    const lines: any[] = Array.isArray(stored) && stored.length ? stored : items.map((item) => ({
      id: item.id,
      name: item.productName,
      product_id: item.productId,
      quantity: item.quantity,
      subtotal: item.totalPrice,
      total: item.totalPrice,
      meta_data: item.modifiers || [],
    }));
    const refundedByItem = new Map<string, { quantity: number; amount: number }>();
    const seenRefunds = new Set<string>();
    refunds.forEach((refund, index) => {
      const metadata = refund.metadata || {};
      const refundKey = String(metadata.refund_id || metadata.legacy_refund_id || `legacy-${index}`);
      if (seenRefunds.has(refundKey)) return;
      seenRefunds.add(refundKey);
      (Array.isArray(metadata.line_items) ? metadata.line_items : []).forEach((item: any) => {
        const key = String(item?.order_item_id ?? '');
        if (!key) return;
        const current = refundedByItem.get(key) || { quantity: 0, amount: 0 };
        current.quantity += Number(item.quantity ?? item.qty ?? 0);
        current.amount += Number(item.refund_total ?? item.refundable_amount ?? 0);
        refundedByItem.set(key, current);
      });
    });
    const presented = lines.filter((line) => !line?.is_refund_item).map((line, index) => {
      const fallback = items[index];
      const lineId = String(line?.id ?? fallback?.id ?? '');
      const refunded = refundedByItem.get(lineId) || { quantity: 0, amount: 0 };
      const originalQuantity = Number(line?.quantity ?? fallback?.quantity ?? 0);
      const remainingQuantity = Math.max(0, originalQuantity - refunded.quantity);
      const remainingRatio = originalQuantity > 0 ? remainingQuantity / originalQuantity : 0;
      const subtotalTax = Number(line?.subtotal_tax ?? 0) * remainingRatio;
      const totalTax = Number(line?.total_tax ?? 0) * remainingRatio;
      const productKey = String(line?.product_id ?? line?.productId ?? fallback?.productId ?? '');
      const product = (line?.product_data ?? products.get(`${storeId}:${productKey}`) ?? {}) as Record<string, any>;
      const discountType = String(this.lineMeta(line, '_pos_discount_type') || '');
      const originalSubtotal = Number(line?.subtotal ?? fallback?.totalPrice ?? 0);
      const originalTotal = Number(line?.total ?? fallback?.totalPrice ?? 0);
      const merchandise = isMerchandiseLine(line);
      const remainingSubtotal = remainingQuantity > 0
        ? (merchandise ? Math.max(0, originalSubtotal - refunded.amount) : originalSubtotal - refunded.amount)
        : 0;
      const remainingLineTotal = remainingQuantity > 0
        ? (merchandise ? Math.max(0, originalTotal - refunded.amount) : originalTotal - refunded.amount)
        : 0;
      return {
        id: line?.id ?? fallback?.id ?? null,
        name: String(line?.name ?? line?.productName ?? fallback?.productName ?? ''),
        product_id: this.numericId(line?.product_id ?? line?.productId ?? fallback?.productId),
        variation_id: Number(line?.variation_id || 0),
        quantity: remainingQuantity,
        tax_class: String(line?.tax_class || ''),
        subtotal: String(remainingSubtotal),
        subtotal_tax: subtotalTax.toFixed(2),
        total: String(remainingLineTotal),
        is_items_has_discount: discountType ? 'Yes' : 'No',
        item_discount_type: this.discountLabel(discountType),
        total_tax: totalTax.toFixed(2),
        taxes: this.remainingTaxes(line?.taxes, remainingRatio),
        image: line?.image ?? { id: product.image?.id ?? product.image_id ?? null, src: product.image?.src ?? product.image_url ?? '' },
        meta_data: Array.isArray(line?.meta_data) ? line.meta_data : (fallback?.modifiers || []),
        _discount_weight: Math.max(originalSubtotal, originalTotal),
        _remaining_ratio: remainingRatio,
      };
    });
    return this.allocateOrderDiscounts(presented, feeLines, couponLines, authoritativeTax)
      .filter((line) => Number(line.quantity) > 0)
      .map(({ _discount_weight, _remaining_ratio, _discounted_subtotal, ...line }) => line);
  }

  /**
   * Merchant discounts are stored as negative fee lines, so Woo line items do
   * not contain their share of the discount. Allocate the realized amount by
   * each merchandise line's pre-tax total. Integer cents and largest remainders keep
   * the allocation exact even when the discount does not divide evenly.
   */
  private allocateOrderDiscounts(
    lines: any[],
    feeLines: any[],
    couponLines: any[],
    authoritativeTax: number,
  ): any[] {
    const merchantFeeCents = (Array.isArray(feeLines) ? feeLines : []).reduce((sum, fee) => {
      const name = String(fee?.name || fee?.fee_name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (name !== 'merchant_discount' && !name.startsWith('merchant_discount_')) return sum;
      return sum + Math.abs(this.cents(fee?.total));
    }, 0);
    let couponCents = 0;
    let merchantCouponCents = 0;
    (Array.isArray(couponLines) ? couponLines : []).forEach((coupon) => {
      const amount = Math.max(0, this.cents(coupon?.discount));
      if (/^pos-discount(?:-\d+)?$/i.test(String(coupon?.code || '').trim())) merchantCouponCents += amount;
      else couponCents += amount;
    });
    const merchantCents = Math.max(merchantFeeCents, merchantCouponCents);
    const remainingAmounts = lines.map((line) => Math.max(
      this.cents(line?.subtotal),
      this.cents(line?.total),
    ));
    const originalAmounts = lines.map((line, index) => Math.max(
      this.cents(line?._discount_weight),
      remainingAmounts[index],
    ));
    const weights = lines.map((line, index) => (
      isMerchandiseLine(line) ? Math.max(0, originalAmounts[index]) : 0
    ));
    const grossCents = weights.reduce((sum, amount) => sum + amount, 0);
    const couponAllocations = this.allocateCents(weights, Math.min(couponCents, grossCents));
    const remainingAfterCoupon = Math.max(0, grossCents - couponAllocations.reduce((sum, amount) => sum + amount, 0));
    const merchantAllocations = this.allocateCents(weights, Math.min(merchantCents, remainingAfterCoupon));

    const distributed = lines.map((line, index) => {
      const remainingRatio = Math.min(1, Math.max(0, Number(line?._remaining_ratio ?? 1)));
      const couponDiscount = Math.round(couponAllocations[index] * remainingRatio);
      const merchantDiscount = Math.round(merchantAllocations[index] * remainingRatio);
      const totalDiscount = couponDiscount + merchantDiscount;
      const discountedSubtotal = isMerchandiseLine(line)
        ? Math.max(0, remainingAmounts[index] - totalDiscount)
        : remainingAmounts[index];
      const tax = isMerchandiseLine(line)
        ? this.taxAfterDiscount(line, discountedSubtotal)
        : this.cents(line?.total_tax);
      const subtotalTax = isMerchandiseLine(line)
        ? this.taxBeforeDiscount(line, remainingAmounts[index])
        : this.cents(line?.subtotal_tax);
      return {
        ...line,
        subtotal_tax: (subtotalTax / 100).toFixed(2),
        total_tax: (tax / 100).toFixed(2),
        taxes: this.taxesAfterDiscount(line?.taxes, remainingAmounts[index], discountedSubtotal),
        coupon_discount: (couponDiscount / 100).toFixed(2),
        merchant_discount: (merchantDiscount / 100).toFixed(2),
        total_discount: (totalDiscount / 100).toFixed(2),
        total_with_tax: ((discountedSubtotal + tax) / 100).toFixed(2),
        _discounted_subtotal: discountedSubtotal,
      };
    });
    return this.reconcileAuthoritativeTax(distributed, authoritativeTax);
  }

  private reconcileAuthoritativeTax(lines: any[], authoritativeTax: number): any[] {
    const targetTax = Math.max(0, this.cents(authoritativeTax));
    const fixedTax = lines.reduce((sum, line) => (
      isMerchandiseLine(line) ? sum : sum + Math.max(0, this.cents(line?.total_tax))
    ), 0);
    const merchandiseTarget = Math.max(0, targetTax - fixedTax);
    const weights = lines.map((line) => (
      isMerchandiseLine(line) && Number(line?.quantity) > 0
        ? Math.max(0, this.cents(line?.total_tax)) || Math.max(0, Number(line?._discounted_subtotal || 0))
        : 0
    ));
    const allocations = this.allocateExactCents(weights, merchandiseTarget);

    return lines.map((line, index) => {
      if (!isMerchandiseLine(line)) return line;
      const tax = allocations[index];
      const discountedSubtotal = Number(line?._discounted_subtotal || 0);
      return {
        ...line,
        total_tax: (tax / 100).toFixed(2),
        taxes: this.reconcileTaxEntries(line?.taxes, tax),
        total_with_tax: ((discountedSubtotal + tax) / 100).toFixed(2),
      };
    });
  }

  private reconcileTaxEntries(taxes: unknown, targetTax: number): unknown {
    if (!Array.isArray(taxes) || !taxes.length) return taxes ?? { total: {}, subtotal: {} };
    const weights = taxes.map((tax: any) => Math.max(0, this.cents(tax?.total)));
    const allocations = this.allocateExactCents(weights, targetTax);
    return taxes.map((tax: any, index) => ({
      ...tax,
      total: (allocations[index] / 100).toFixed(2),
    }));
  }

  private taxAfterDiscount(line: any, discountedSubtotal: number): number {
    const taxes = Array.isArray(line?.taxes) ? line.taxes : [];
    const rates = taxes.map((tax: any) => Number(tax?.rate_percent ?? tax?.id))
      .filter((rate: number) => Number.isFinite(rate) && rate > 0 && rate <= 100);
    if (!rates.length) return this.cents(line?.total_tax);
    return rates.reduce((sum: number, rate: number) => (
      sum + Math.round(discountedSubtotal * rate / 100)
    ), 0);
  }

  private taxBeforeDiscount(line: any, originalSubtotal: number): number {
    const taxes = Array.isArray(line?.taxes) ? line.taxes : [];
    const rates = taxes.map((tax: any) => Number(tax?.rate_percent ?? tax?.id))
      .filter((rate: number) => Number.isFinite(rate) && rate > 0 && rate <= 100);
    if (!rates.length) return this.cents(line?.subtotal_tax);
    return rates.reduce((sum: number, rate: number) => (
      sum + Math.round(originalSubtotal * rate / 100)
    ), 0);
  }

  private taxesAfterDiscount(taxes: unknown, originalSubtotal: number, discountedSubtotal: number): unknown {
    if (!Array.isArray(taxes)) return taxes ?? { total: {}, subtotal: {} };
    return taxes.map((tax: any) => {
      const rate = Number(tax?.rate_percent ?? tax?.id);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return tax;
      return {
        ...tax,
        subtotal: (Math.round(originalSubtotal * rate / 100) / 100).toFixed(2),
        total: (Math.round(discountedSubtotal * rate / 100) / 100).toFixed(2),
      };
    });
  }

  private allocateCents(weights: number[], requestedCents: number): number[] {
    const base = weights.reduce((sum, amount) => sum + amount, 0);
    const amount = Math.min(Math.max(0, requestedCents), base);
    const allocations = new Array(weights.length).fill(0);
    if (!amount || !base) return allocations;
    const ranked = weights.map((weight, index) => {
      const exact = amount * weight;
      allocations[index] = Math.floor(exact / base);
      return { index, remainder: exact % base, weight };
    });
    let remainder = amount - allocations.reduce((sum, share) => sum + share, 0);
    ranked.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
    for (let index = 0; index < ranked.length && remainder > 0; index += 1, remainder -= 1) {
      allocations[ranked[index].index] += 1;
    }
    return allocations;
  }

  private allocateExactCents(weights: number[], requestedCents: number): number[] {
    const amount = Math.max(0, requestedCents);
    const base = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    const allocations = new Array(weights.length).fill(0);
    if (!amount || !base) return allocations;
    const ranked = weights.map((weight, index) => {
      const exact = amount * Math.max(0, weight);
      allocations[index] = Math.floor(exact / base);
      return { index, remainder: exact % base, weight };
    });
    let remainder = amount - allocations.reduce((sum, share) => sum + share, 0);
    ranked.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
    for (let index = 0; index < ranked.length && remainder > 0; index += 1, remainder -= 1) {
      allocations[ranked[index].index] += 1;
    }
    return allocations;
  }

  private refundedItemsTax(
    storedLines: unknown[] | undefined,
    fallbackItems: OrderItemEntity[],
    refunds: Array<{ metadata: Record<string, any> | null }>,
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

    return this.round(storedLines.reduce<number>((sum, line: any, index) => {
      const lineId = String(line?.id ?? fallbackItems[index]?.id ?? '');
      const refundedQuantity = refundedQuantities.get(lineId);
      if (refundedQuantity === undefined) return sum;
      const storedQuantity = Number(line?.quantity);
      const quantity = Number.isFinite(storedQuantity) && storedQuantity > 0 ? storedQuantity : 1;
      const storedTax = Number(line?.total_tax);
      const lineTax = Number.isFinite(storedTax)
        ? storedTax
        : (Array.isArray(line?.taxes)
          ? line.taxes.reduce((taxSum: number, entry: any) => taxSum + Number(entry?.total || 0), 0)
          : 0);
      return sum + lineTax * Math.min(1, refundedQuantity / quantity);
    }, 0));
  }

  private positiveInteger(value: string | undefined, fallback: number, name: string): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException(`${name} must be a whole number greater than 0`);
    return parsed;
  }

  private dateBoundary(value: string | undefined, endOfDay: boolean, name: string): Date | undefined {
    if (!value?.trim()) return undefined;
    const input = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
      : value;
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${name} must be a valid date or ISO-8601 timestamp`);
    return parsed;
  }

  private orderId(order: OrderEntity): string | number {
    const digits = String(order.orderNumber || '').replace(/\D/g, '');
    return digits && Number.isSafeInteger(Number(digits)) ? Number(digits) : order.id;
  }

  private clientOrderId(order: OrderEntity, storeOrder: StoreOrderEntity | null): string | number | null {
    const value = String(storeOrder?.clientOrderId || order.clientOrderId || this.metaValue(order, '_pos_client_order_id') || '').trim();
    if (!value) return null;
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
  }

  private metaValue(order: OrderEntity, key: string): unknown {
    return (Array.isArray(order.metadata) ? order.metadata : []).find((entry) => entry?.key === key)?.value;
  }

  private lineMeta(line: any, key: string): unknown {
    return (Array.isArray(line?.meta_data) ? line.meta_data : []).find((entry: any) => entry?.key === key)?.value;
  }

  private remainingTaxes(taxes: unknown, ratio: number): unknown {
    if (!Array.isArray(taxes)) return taxes ?? { total: {}, subtotal: {} };
    return taxes.map((tax: any) => ({
      ...tax,
      total: (Number(tax?.total || 0) * ratio).toFixed(2),
      subtotal: (Number(tax?.subtotal || 0) * ratio).toFixed(2),
    }));
  }

  private discountLabel(type: string): string {
    return ({ auto: 'Auto Discount', multipack: 'Multipack Discount', mixmatch: 'Combo Discount' } as Record<string, string>)[type] || '';
  }

  private numericId(value: unknown): string | number | null {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : String(value);
  }

  private money(value: unknown): string { return Number(value || 0).toFixed(2); }
  private round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
  private cents(value: unknown): number { return Math.round(Number(value || 0) * 100); }
  private decimal(value: unknown): string { return String(value ?? '0'); }
  private isoDate(value: Date): string { return new Date(value).toISOString(); }

  private currencySymbol(currency: string): string {
    return ({ EUR: '€', GBP: '£', INR: '₹', USD: '$' } as Record<string, string>)[currency] || '$';
  }

  private displayDate(value: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || '';
    return `${part('month')} ${part('day')}, ${part('year')}`;
  }
}
