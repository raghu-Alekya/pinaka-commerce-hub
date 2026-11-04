import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { StoreSetupModule } from '../master/store-setup/store-setup.module';
import { MerchantModule } from '../merchant/merchant.module';
import { StorePosPaymentsController } from './store-pos-payments.controller';
import { CouponModule } from './coupons/coupon.module';
import { ProductOptionsService } from './product-options.service';
import { PosEmployeeCatalogGuard } from './pos-employee-catalog.guard';
import { PosAuthModule } from '../pos-auth/pos-auth.module';

@Module({
  imports: [MerchantModule, StoreSetupModule, CouponModule, PosAuthModule],
  controllers: [AppController, StorePosPaymentsController],
  providers: [ProductOptionsService, PosEmployeeCatalogGuard],
})
export class StoreModule {}
