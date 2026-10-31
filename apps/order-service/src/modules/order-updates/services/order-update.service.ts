import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  isMerchantDiscountCode,
  merchantDiscountCoverage,
  moneyAmount,
  readCouponLine,
  selectMinimumEligibleCoupon,
  withCouponBase,
  type CouponSpec,
} from '../../../calculations/order-update.calculations';
import { OrderRepository } from '../../../order.repository';
import type { AddOrderItemsDto, ApplyCouponDto, ApplyDiscountDto, CancelOrderDto, UpdateOrderDto } from '../dto/order-update.dto';
import { cancelFromDto, couponFromDto, discountFromDto, itemsFromDto } from '../order-update.normalize';
import { OrderUpdatePresenter } from '../order-update.presenter';
import { OrderStatus } from '../../../entities/order.entity';
import {
  calculateDiscountTotal,
  listOrderTotal,
  orderTotalWithTax,
  sumCouponDiscounts,
  type PosCouponLine,
  type PosFeeLine,
  type PosLineItem,
  type PosTaxLine,
} from '../../../calculations/store-order.calculations';
import type { OrderGraph, OrderMutationDraft } from '../order-update.types';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderCouponCatalog } from './order-coupon.catalog';
import { OrderCouponService } from './order-coupon.service';
import { OrderDiscountService } from './order-discount.service';
import { OrderItemService } from './order-item.service';
import { OrderLineMapper } from './order-line.mapper';

@Injectable()
export class OrderUpdateService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OrderCouponService) private readonly coupons: OrderCouponService,
    @Inject(OrderCouponCatalog) private readonly couponCatalog: OrderCouponCatalog,
    @Inject(OrderDiscountService) private readonly discounts: OrderDiscountService,
    @Inject(OrderItemService) private readonly items: OrderItemService,
    @Inject(OrderCancellationService) private readonly cancellation: OrderCancellationService,
    @Inject(OrderLineMapper) private readonly lines: OrderLineMapper,
    @Inject(OrderUpdatePresenter) private readonly presenter: OrderUpdatePresenter,
  ) {}

  async replace(
    orderId: string,
    payload: Record<string, unknown>,
    scope: { storeId?: string; merchantId?: string } = {},
  ) {
    const graph = await this.orders.replaceOrderSnapshot(orderId, payload, scope);
    return this.presenter.present(graph);
  }

  async update(orderId: string, dto: UpdateOrderDto) {
    const hasCoupons = dto.coupon_lines !== undefined;
    const hasStatus = dto.status !== undefined && dto.status.trim() !== '';
    if (!hasCoupons && !hasStatus) {
      throw new BadRequestException('coupon_lines or status is required');
    }
    let graph = await this.load(orderId);
    if (hasCoupons) {
      const requested = dto.coupon_lines || [];
      const existing = Array.isArray(graph.storeOrder?.couponLines)
        ? graph.storeOrder.couponLines
        : [];
      // Some POS clients send their default empty coupon array again with the
      // final status transition. That is not an explicit coupon-removal action
      // and must not erase a coupon already persisted for the order. A
      // coupon-only update with [] still performs the intentional removal.
      const staleEmptyCouponsOnStatus = hasStatus && requested.length === 0 && existing.length > 0;
      if (!staleEmptyCouponsOnStatus) {
        const coupons = await this.couponsForOrder(graph, requested);
        graph = await this.persist(graph, this.coupons.sync(graph, coupons));
      }
    }
    if (hasStatus) {
      graph = await this.persist(graph, this.statusChange(graph, String(dto.status)));
    }
    return this.presenter.present(graph);
  }

  private statusChange(graph: OrderGraph, requested: string): OrderMutationDraft {
    const status = requested.trim().toLowerCase();
    if (status === 'cancelled' || status === 'canceled') {
      return this.cancellation.cancel(graph, cancelFromDto({}));
    }
    // Cancellation is terminal. A delayed coupon/navigation request may still
    // carry the order's former `processing` status and must not reopen it.
    this.cancellation.assertStatusChangeAllowed(graph);
    const allowed = new Set(['pending', 'processing', 'on-hold', 'completed', 'refunded', 'failed']);
    if (!allowed.has(status)) {
      throw new BadRequestException('status must be pending, processing, on-hold, completed, cancelled, refunded, or failed');
    }
    return {
      orderStatus: status === 'completed'
        ? OrderStatus.COMPLETED
        : status === 'refunded'
          ? OrderStatus.REFUNDED
          : OrderStatus.CREATED,
      storeStatus: status,
      replaceItems: false,
      history: {
        changedBy: 'POS',
        reason: `Status updated to ${status}`.slice(0, 255),
      },
    };
  }

  async applyCoupon(orderId: string, dto: ApplyCouponDto) {
    const graph = await this.load(orderId);
    const coverage = this.coverage(graph);
    if (coverage.coversOrder) {
      throw new BadRequestException(
        'A coupon cannot be applied because the merchant discount already covers the order total',
      );
    }
    if (coverage.merchantDiscount > 0) {
      const chosen = await this.minimumEligibleCoupon(graph, coverage.remaining);
      if (chosen) {
        const saved = await this.persist(graph, this.coupons.sync(graph, [chosen]));
        return this.presenter.present(saved);
      }
    }
    const command = couponFromDto(dto);
    const draft = this.coupons.apply(graph, command);
    const saved = await this.persist(graph, draft);
    return this.presenter.present(saved);
  }

  async applyDiscount(orderId: string, dto: ApplyDiscountDto) {
    const graph = await this.load(orderId);
    const draft = this.discounts.apply(graph, discountFromDto(dto));
    this.overlay(graph, draft);
    const coverage = merchantDiscountCoverage(draft.lineItems || [], draft.couponLines || []);
    let next = draft;
    if (coverage.coversOrder) {
      if (this.hasStoreCoupon(draft.couponLines)) next = this.coupons.sync(graph, []);
    } else if (coverage.merchantDiscount > 0 && coverage.remaining > 0) {
      const chosen = await this.minimumEligibleCoupon(graph, coverage.remaining);
      if (chosen) next = this.coupons.sync(graph, [chosen]);
    }
    const saved = await this.persist(graph, next);
    return this.presenter.present(saved);
  }

  async addItems(orderId: string, dto: AddOrderItemsDto) {
    const graph = await this.load(orderId);
    const command = itemsFromDto(dto);
    const draft = this.items.add(graph, command);
    const saved = await this.persist(graph, draft);
    return this.presenter.present(saved);
  }

  async cancel(orderId: string, dto: CancelOrderDto = {}) {
    const graph = await this.load(orderId);
    const draft = this.cancellation.cancel(graph, cancelFromDto(dto));
    const saved = await this.persist(graph, draft);
    return this.presenter.present(saved);
  }

  private async couponsForOrder(
    graph: OrderGraph,
    requested: Array<{ code: string }>,
  ): Promise<CouponSpec[]> {
    const coverage = this.coverage(graph);
    if (requested.length && coverage.coversOrder) {
      throw new BadRequestException(
        'A coupon cannot be applied because the merchant discount already covers the order total',
      );
    }
    if (!requested.length) return [];
    const lines = this.lines.fromGraph(graph).map((line) => withCouponBase(line));
    const email = this.billingEmail(graph);
    if (coverage.merchantDiscount > 0) {
      const chosen = await this.minimumEligibleCoupon(graph, coverage.remaining)
        ?? await this.minimumResolvedCoupon(graph, requested, lines, email, coverage.remaining);
      if (!chosen) throw new BadRequestException('No eligible coupon applies to the remaining balance');
      return [chosen];
    }
    return Promise.all(requested.map((line) => this.couponCatalog.resolve({
      storeId: graph.order.storeId,
      code: line.code,
      lines,
      email,
      couponCount: requested.length,
    })));
  }

  private async minimumResolvedCoupon(
    graph: OrderGraph,
    requested: Array<{ code: string }>,
    lines: ReturnType<OrderLineMapper['fromGraph']>,
    email: string | undefined,
    remaining: number,
  ): Promise<CouponSpec | undefined> {
    const resolved: CouponSpec[] = [];
    let firstError: unknown;
    for (const line of requested) {
      try {
        resolved.push(await this.couponCatalog.resolve({
          storeId: graph.order.storeId,
          code: line.code,
          lines,
          email,
          couponCount: 1,
        }));
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
    const chosen = selectMinimumEligibleCoupon(resolved, remaining);
    if (chosen) return chosen;
    if (firstError) throw firstError;
    return undefined;
  }

  private async minimumEligibleCoupon(graph: OrderGraph, remaining: number): Promise<CouponSpec | undefined> {
    const lines = this.lines.fromGraph(graph).map((line) => withCouponBase(line));
    const eligible = await this.couponCatalog.eligible({
      storeId: graph.order.storeId,
      lines,
      email: this.billingEmail(graph),
    });
    return selectMinimumEligibleCoupon(eligible, remaining);
  }

  private coverage(graph: OrderGraph) {
    const couponLines = Array.isArray(graph.storeOrder?.couponLines) ? graph.storeOrder.couponLines : [];
    return merchantDiscountCoverage(this.lines.fromGraph(graph), couponLines);
  }

  private hasStoreCoupon(couponLines: unknown[] | undefined): boolean {
    return (couponLines || []).some((line) => {
      const parsed = readCouponLine(line);
      return parsed ? !isMerchantDiscountCode(parsed.code) : false;
    });
  }

  private overlay(graph: OrderGraph, draft: OrderMutationDraft): void {
    const storeOrder = graph.storeOrder;
    if (!storeOrder) return;
    if (draft.lineItems) storeOrder.lineItems = draft.lineItems;
    if (draft.couponLines) storeOrder.couponLines = draft.couponLines;
    if (draft.feeLines) storeOrder.feeLines = draft.feeLines;
    if (draft.taxLines) storeOrder.taxLines = draft.taxLines;
  }

  private billingEmail(graph: OrderGraph): string | undefined {
    const payload = graph.order.requestPayload as { billing?: { email?: string } } | null;
    const email = payload?.billing?.email;
    return typeof email === 'string' && email.trim() ? email.trim() : undefined;
  }

  private async load(orderId: string): Promise<OrderGraph> {
    const graph = await this.orders.getOrderByReference(orderId);
    if (!graph) throw new NotFoundException(`Order '${orderId}' not found`);
    return graph;
  }

  private async persist(graph: OrderGraph, draft: OrderMutationDraft): Promise<OrderGraph> {
    const order = graph.order;
    const fromStatus = String(order.orderStatus);
    const tip = Number(order.tipAmount || 0);
    const tipAmount = Number.isFinite(tip) ? tip : 0;
    if (draft.orderStatus) order.orderStatus = draft.orderStatus;
    const pricesIncludeTax = Boolean(
      (order.requestPayload as { prices_include_tax?: boolean } | null)?.prices_include_tax,
    );
    const inclusiveTotal = draft.totals
      ? orderTotalWithTax({
        netBeforeTax: draft.totals.total + tipAmount,
        tax: draft.totals.taxTotal,
        pricesIncludeTax,
      })
      : undefined;
    if (draft.totals && inclusiveTotal !== undefined) {
      order.subtotal = moneyAmount(draft.totals.subtotal);
      order.discountAmount = moneyAmount(draft.totals.discountTotal);
      order.taxAmount = moneyAmount(draft.totals.taxTotal);
      order.totalAmount = moneyAmount(inclusiveTotal);
    }
    order.updatedAt = new Date();

    const storeOrder = graph.storeOrder;
    if (storeOrder) {
      if (draft.lineItems) storeOrder.lineItems = draft.lineItems;
      if (draft.couponLines) storeOrder.couponLines = draft.couponLines;
      if (draft.feeLines) storeOrder.feeLines = draft.feeLines;
      if (draft.taxLines) storeOrder.taxLines = draft.taxLines;
      if (draft.totals) {
        storeOrder.subtotal = moneyAmount(draft.totals.subtotal);
        storeOrder.feeTotal = moneyAmount(draft.totals.feeTotal);
        storeOrder.taxTotal = moneyAmount(draft.totals.taxTotal);
        storeOrder.total = moneyAmount(inclusiveTotal ?? draft.totals.total + tipAmount);
      }
      const lineItems = (Array.isArray(storeOrder.lineItems) ? storeOrder.lineItems : []) as PosLineItem[];
      const couponLines = (Array.isArray(storeOrder.couponLines) ? storeOrder.couponLines : []) as PosCouponLine[];
      const feeLines = (Array.isArray(storeOrder.feeLines) ? storeOrder.feeLines : []) as PosFeeLine[];
      const taxLines = (Array.isArray(storeOrder.taxLines) ? storeOrder.taxLines : []) as PosTaxLine[];
      storeOrder.discountTotal = calculateDiscountTotal(lineItems, couponLines, feeLines);
      const payloadForTotals = (storeOrder.requestPayload || order.requestPayload || {}) as Record<string, unknown>;
      storeOrder.grandTotal = listOrderTotal({
        total: storeOrder.total,
        tax: storeOrder.taxTotal,
        taxLines,
        couponDiscount: sumCouponDiscounts(couponLines),
        lineItems,
        feeLines,
        shippingTotal: payloadForTotals.shipping_total ?? payloadForTotals.shippingTotal,
        tip: storeOrder.tipAmount,
      });
      if (draft.storeStatus) storeOrder.status = draft.storeStatus;
      const requestPayload = { ...((storeOrder.requestPayload || order.requestPayload || {}) as Record<string, unknown>) };
      if (draft.lineItems) requestPayload.line_items = storeOrder.lineItems;
      if (draft.couponLines) requestPayload.coupon_lines = storeOrder.couponLines;
      if (draft.feeLines) requestPayload.fee_lines = storeOrder.feeLines;
      if (draft.taxLines) requestPayload.tax_lines = storeOrder.taxLines;
      if (draft.totals) {
        requestPayload.subtotal = moneyAmount(storeOrder.subtotal).toFixed(2);
        requestPayload.discount_total = moneyAmount(storeOrder.discountTotal).toFixed(2);
        requestPayload.total_tax = moneyAmount(storeOrder.taxTotal).toFixed(2);
        requestPayload.total = moneyAmount(storeOrder.total).toFixed(2);
        requestPayload.grand_total = moneyAmount(storeOrder.grandTotal).toFixed(2);
      }
      if (draft.storeStatus) requestPayload.status = storeOrder.status;
      storeOrder.requestPayload = requestPayload;
      order.requestPayload = requestPayload;
      storeOrder.updatedAt = new Date();
    }

    const items = draft.replaceItems && draft.lineItems
      ? this.lines.toEntities(order.id, draft.lineItems)
      : graph.items;
    const saved = await this.orders.saveOrderMutation({
      order,
      items,
      storeOrder,
      replaceItems: Boolean(draft.replaceItems),
      history: draft.history
        ? {
            fromStatus,
            toStatus: String(order.orderStatus),
            changedBy: draft.history.changedBy,
            reason: draft.history.reason,
          }
        : undefined,
    });
    return saved;
  }
}
