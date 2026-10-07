import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module';
import { DeviceController } from './device.controller';
import { DeviceRepository } from './device.repository';
import { DeviceService } from './device.service';

@Module({
  imports: [MerchantModule],
  controllers: [DeviceController],
  providers: [DeviceService, DeviceRepository],
  exports: [DeviceService],
})
export class DeviceModule {}
