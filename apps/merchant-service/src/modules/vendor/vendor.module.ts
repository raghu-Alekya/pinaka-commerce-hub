import { Module } from '@nestjs/common';
import { MerchantVendorController } from './merchant-vendor.controller';
import { VendorController } from './vendor.controller';
import { VendorRepository } from './vendor.repository';
import { MerchantModule } from '../merchant/merchant.module';
import { RelationshipsModule } from '../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [VendorController, MerchantVendorController],
  providers: [VendorRepository],
  exports: [VendorRepository],
})
export class VendorModule {}
