import { Module } from '@nestjs/common';
import { MerchantModule } from '../../merchant/merchant.module';
import { StoreDeviceMappingController } from './store-device-mapping.controller';
import { StoreDeviceMappingRepository } from './store-device-mapping.repository';
import { StoreDeviceMappingService } from './store-device-mapping.service';

@Module({
  imports: [MerchantModule],
  controllers: [StoreDeviceMappingController],
  providers: [StoreDeviceMappingRepository, StoreDeviceMappingService],
  exports: [StoreDeviceMappingService],
})
export class DeviceMappingsModule {}
