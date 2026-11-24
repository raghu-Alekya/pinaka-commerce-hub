import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  applyCoupon,
  buildCouponLine,
  isMerchantDiscountCode,
  merchantDiscountCoverage,
  readCouponLine,
  withCouponBase,
  type CouponSpec,
} from '../../../calculations/order-update.calculations';
import {
  applyPosSaleCalculation,
  effectiveFeeTotal,
  isCouponDiscountFee,
  recognizedItemDiscountMinor,
  recordAppliedCouponAmount,
  sumLineTotals,
  type PosFeeLine,
  type PosTaxLine,
} from '../../../calculations/store-order.calculations';
import type { CouponCommand, OrderGraph, OrderMutationDraft } from '../order-update.types';
import { OrderLineMapper } from './order-line.mapper';
import { OrderTotalsService } from './order-totals.service';
import { OrderUpdatePolicy } from './order-update.policy';

@Injectable()
export class OrderCouponService {
  constructor(
    @Inject(OrderUpdatePolicy) private readonly policy: OrderUpdatePolicy,
    @Inject(OrderLineMapper) private readonly lines: OrderLineMapper,
    @Inject(OrderTotalsService) private readonly totals: OrderTotalsService,
  ) {}

  apply(graph: OrderGraph, command: CouponCommand): OrderMutationDraft {
    this.policy.assertMutable(graph);
    const store = this.policy.requireStoreOrder(graph);
    const code = command.code.trim();
    if (!code) throw new BadRequestException('Coupon code is required');
    if (command.amount <= 0) throw new BadRequestException('Discount amount must be greater than zero');
    if (command.discountType === 'percent' && command.amount > 100) {
      throw new BadRequestException('Percent discount must be between 0 and 100');
    }
    const couponLines = Array.isArray(store.couponLines) ? store.couponLines : [];
    if (this.codeExists(couponLines, code)) {
      throw new ConflictException(`Coupon '${code}' is already applied`);
    }

    const sourceLines = this.lines.fromGraph(graph);
    if (sourceLines.some((line) => recognizedItemDiscountMinor(line) > 0)) {
      return this.applyBesideItemDiscounts(graph, command, couponLines);
    }

    const applied = applyCoupon(sourceLines, {
      code,
      discountType: command.discountType,
      amount: command.amount,
      productIds: command.productIds,
    });
    if (applied.discount <= 0) {
      throw new BadRequestException('Coupon does not reduce this order');
    }

    const priced = this.totals.priceLines(graph, applied.lineItems, {
      includeFees: command.includeFees,
      tax: command.tax,
    });
    return {
      ...priced,
      couponLines: [
        ...couponLines,
        buildCouponLine({
          code,
          discountType: command.discountType,
          amount: command.amount,
          productIds: command.productIds,
        }, applied.discount, 2, command.reason),
      ],
      replaceItems: true,
      appliedDiscount: applied.discount,
    };
  }

  sync(graph: OrderGraph, coupons: CouponSpec[]): OrderMutationDraft {
    this.policy.assertMutable(graph);
    const store = this.policy.requireStoreOrder(graph);
    const seen = new Set<string>();
    coupons.forEach((coupon) => {
      const code = coupon.code.trim().toLowerCase();
      if (!code || isMerchantDiscountCode(coupon.code)) {
        throw new BadRequestException(`Coupon '${coupon.code}' is not a store coupon`);
      }
      if (seen.has(code)) throw new BadRequestException(`Coupon '${coupon.code}' is repeated`);
      seen.add(code);
    });

    const existing = Array.isArray(store.couponLines) ? store.couponLines : [];
    const merchantLines = existing.filter((line) => {
      const parsed = readCouponLine(line);
      return parsed ? isMerchantDiscountCode(parsed.code) : false;
    });

    let lineItems = this.lines.fromGraph(graph).map((line) => withCouponBase(line));
    const embedded = merchantDiscountCoverage(lineItems, []).merchantDiscount;
    const recorded = merchantLines.reduce((sum: number, line) => sum + (readCouponLine(line)?.discount || 0), 0);
    if (recorded > embedded + 0.004) {
      merchantLines.forEach((line) => {
        const parsed = readCouponLine(line);
        if (!parsed || parsed.discount <= 0) return;
        const applied = applyCoupon(lineItems, {
          code: parsed.code,
          discountType: 'fixed_cart',
          amount: parsed.discount,
        });
        if (applied.discount > 0) lineItems = applied.lineItems;
      });
    }

    const coverage = merchantDiscountCoverage(lineItems, merchantLines);
    if (coupons.length && coverage.coversOrder) {
      throw new BadRequestException(
        'A coupon cannot be applied because the merchant discount already covers the order total',
      );
    }

    const couponLines: unknown[] = [...merchantLines];
    coupons.forEach((coupon) => {
      const applied = applyCoupon(lineItems, coupon);
      if (applied.discount <= 0) {
        throw new BadRequestException(`Coupon '${coupon.code}' does not reduce this order`);
      }
      lineItems = applied.lineItems;
      couponLines.push(buildCouponLine(coupon, applied.discount));
    });

    const priced = this.totals.priceLines(graph, lineItems);
    return {
      ...priced,
      couponLines,
      replaceItems: true,
    };
  }

  /**
   * A line-item discount already owns the gap between subtotal and total.
   * The coupon stays on its own row and the line totals stay after the item discount.
   */
  private applyBesideItemDiscounts(
    graph: OrderGraph,
    command: CouponCommand,
    couponLines: unknown[],
  ): OrderMutationDraft {
    const store = this.policy.requireStoreOrder(graph);
    const sourceLines = this.lines.fromGraph(graph).map((line) => this.copyLine(line));
    const trial = applyCoupon(sourceLines.map((line) => this.copyLine(line)), {
      code: command.code,
      discountType: command.discountType,
      amount: command.amount,
      productIds: command.productIds,
    });
    if (trial.discount <= 0) {
      throw new BadRequestException('Coupon does not reduce this order');
    }
    const coupon = buildCouponLine({
      code: command.code,
      discountType: command.discountType,
      amount: command.amount,
      productIds: command.productIds,
    }, trial.discount, 2, command.reason);
    const nextCoupons = [...couponLines, coupon];
    const request = (store.requestPayload || graph.order.requestPayload || {}) as Record<string, unknown>;
    const metadata = Array.isArray(request.meta_data)
      ? (request.meta_data as Array<{ key?: string; value?: unknown }>).map((entry) => ({ ...entry }))
      : [];
    const saleLines = sourceLines.map((line) => this.copyLine(line));
    const storedTax = (Array.isArray(store.taxLines) ? store.taxLines : []) as PosTaxLine[];
    const fallbackRate = Number(storedTax[0]?.rate_percent || 0);
    if (fallbackRate > 0) {
      saleLines.forEach((line) => {
        if (!Array.isArray(line.taxes) || line.taxes.length === 0) {
          line.taxes = [{ id: fallbackRate, rate_percent: fallbackRate }];
        }
      });
    }
    const fees = (Array.isArray(store.feeLines) ? store.feeLines : []).map((fee) => ({ ...fee })) as PosFeeLine[];
    if (!fees.some((fee) => isCouponDiscountFee(fee))) {
      fees.push({ name: 'coupon_discount', total: '0.00', tax_status: 'none' });
    }
    const pricesIncludeTax = Boolean(request.prices_include_tax);
    const shippingTotal = Number(request.shipping_total ?? request.shippingTotal ?? 0);
    const payload = {
      coupon_lines: nextCoupons as Array<{ code?: string; discount?: string }>,
      fee_lines: fees,
      meta_data: metadata,
      prices_include_tax: pricesIncludeTax,
      shipping_total: Number.isFinite(shippingTotal) ? shippingTotal : 0,
      tax_lines: storedTax.map((line) => ({ ...line })),
    };
    const sale = applyPosSaleCalculation(saleLines, payload);
    if (!sale || sale.coupon <= 0) {
      throw new BadRequestException('Coupon does not reduce this order');
    }
    coupon.discount = sale.coupon.toFixed(2);
    recordAppliedCouponAmount(payload, sale.coupon);
    request.meta_data = payload.meta_data;
    store.requestPayload = request;
    graph.order.requestPayload = request;
    const net = pricesIncludeTax
      ? sale.total
      : Math.round((sale.total - sale.tax) * 100) / 100;
    return {
      lineItems: saleLines,
      couponLines: nextCoupons,
      feeLines: payload.fee_lines,
      taxLines: (payload.tax_lines || []) as PosTaxLine[],
      totals: {
        subtotal: sale.subtotal,
        discountTotal: sale.discountTotal,
        lineTotal: sumLineTotals(saleLines),
        feeTotal: effectiveFeeTotal(payload.fee_lines),
        taxTotal: sale.tax,
        shippingTotal: Number.isFinite(shippingTotal) ? shippingTotal : 0,
        total: net,
      },
      replaceItems: true,
      appliedDiscount: sale.coupon,
    };
  }

  private copyLine<T extends { meta_data?: Array<{ key?: string; value?: unknown }>; taxes?: unknown[] }>(line: T): T {
    return {
      ...line,
      meta_data: Array.isArray(line.meta_data) ? line.meta_data.map((entry) => ({ ...entry })) : line.meta_data,
      taxes: Array.isArray(line.taxes) ? line.taxes.map((entry) => ({ ...(entry as object) })) : line.taxes,
    };
  }

  private codeExists(couponLines: unknown[], code: string): boolean {
    const target = code.trim().toLowerCase();
    return couponLines.some((line) => {
      if (!line || typeof line !== 'object') return false;
      return String((line as { code?: unknown }).code || '').trim().toLowerCase() === target;
    });
  }
}
