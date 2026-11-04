import { Module } from '@nestjs/common';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
import { IssuingCouponService } from './issuing-coupon.service';
@Module({ controllers: [CouponController], providers: [CouponService, IssuingCouponService], exports: [CouponService] })
export class CouponModule {}
