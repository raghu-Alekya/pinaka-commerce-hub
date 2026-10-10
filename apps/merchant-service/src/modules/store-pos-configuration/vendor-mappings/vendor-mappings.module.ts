import { Module } from '@nestjs/common';
import { MerchantModule } from '../../merchant/merchant.module';
import { StoreVendorMappingController } from './store-vendor-mapping.controller';
import { StoreVendorMappingRepository } from './store-vendor-mapping.repository';
import { StoreVendorMappingService } from './store-vendor-mapping.service';

@Module({
  imports: [MerchantModule],
  controllers: [StoreVendorMappingController],
  providers: [StoreVendorMappingRepository, StoreVendorMappingService],
  exports: [StoreVendorMappingService],
})
export class VendorMappingsModule {}
