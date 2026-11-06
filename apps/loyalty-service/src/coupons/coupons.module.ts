import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller';
import { IssuingCouponService } from './issuing-coupon.service';

@Module({
  controllers: [CouponsController],
  providers: [IssuingCouponService],
})
export class CouponsModule {}
