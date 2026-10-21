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

    const applied = applyCoupon(this.lines.fromGraph(graph), {
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

  private codeExists(couponLines: unknown[], code: string): boolean {
    const target = code.trim().toLowerCase();
    return couponLines.some((line) => {
      if (!line || typeof line !== 'object') return false;
      return String((line as { code?: unknown }).code || '').trim().toLowerCase() === target;
    });
  }
}
