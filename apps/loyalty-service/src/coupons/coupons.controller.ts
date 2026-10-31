import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { IssuingCouponService } from './issuing-coupon.service';
import { parseIssuingCouponRequest } from './issuing-coupons';

@Controller('api/v1/coupons')
export class CouponsController {
  constructor(@Inject(IssuingCouponService) private readonly coupons: IssuingCouponService) {}

  @Get('issuing-coupons')
  @Post('issuing-coupons')
  @HttpCode(HttpStatus.OK)
  async issuingCoupons(
    @Body() body: { line_items?: unknown; store_id?: unknown; storeId?: unknown },
    @Headers('x-store-id') storeHeader?: string,
  ) {
    const request = parseIssuingCouponRequest(body, storeHeader);
    return {
      order_total: request.orderTotal,
      coupons: await this.coupons.findApplicable(request.lineItems, request.orderTotal, request.storeId),
    };
  }
}
