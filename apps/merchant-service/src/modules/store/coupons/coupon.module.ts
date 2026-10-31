import { Module } from '@nestjs/common';
import { IssuingCouponService } from '../../../../loyalty-service/src/coupons/issuing-coupon.service';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
@Module({ controllers: [CouponController], providers: [CouponService, IssuingCouponService], exports: [CouponService] })
export class CouponModule {}
