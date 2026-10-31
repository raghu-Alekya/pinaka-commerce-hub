import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IssuingCouponService } from './issuing-coupon.service';
import { orderTotalFromLineItems } from './issuing-coupons';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/v1/coupons')
export class CouponsController {
  constructor(@Inject(IssuingCouponService) private readonly coupons: IssuingCouponService) {}

  @Post('issuing-coupons')
  @HttpCode(HttpStatus.OK)
  async issuingCoupons(
    @Body() body: { line_items?: unknown; store_id?: unknown; storeId?: unknown },
    @Headers('x-store-id') storeHeader?: string,
  ) {
    if (!Array.isArray(body?.line_items) || body.line_items.length === 0) {
      throw new BadRequestException('line_items are required');
    }
    const orderTotal = orderTotalFromLineItems(body.line_items);
    if (orderTotal <= 0) {
      throw new BadRequestException('Calculated order total is invalid');
    }
    return {
      order_total: orderTotal,
      coupons: await this.coupons.findApplicable(body.line_items, orderTotal, this.storeId(body, storeHeader)),
    };
  }

  private storeId(
    body: { store_id?: unknown; storeId?: unknown },
    storeHeader?: string,
  ): string | null {
    const header = String(storeHeader || '').trim();
    const fromBody = String(body.store_id ?? body.storeId ?? '').trim();
    if (header && fromBody && header !== fromBody) {
      throw new BadRequestException('Conflicting store IDs');
    }
    const storeId = header || fromBody;
    if (!storeId) return null;
    if (!UUID.test(storeId)) throw new BadRequestException('store_id must be a UUID');
    return storeId;
  }
}
