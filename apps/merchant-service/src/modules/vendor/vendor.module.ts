import { Module } from '@nestjs/common';
import { MerchantVendorController } from './merchant-vendor.controller';
import { StoreVendorPaymentController, VendorController } from './vendor.controller';
import { VendorRepository } from './vendor.repository';
import { MerchantModule } from '../merchant/merchant.module';
import { RelationshipsModule } from '../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [VendorController, MerchantVendorController, StoreVendorPaymentController],
  providers: [VendorRepository],
  exports: [VendorRepository],
})
export class VendorModule {}
