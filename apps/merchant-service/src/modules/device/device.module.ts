import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module';
import { PosAuthModule } from '../pos-auth/pos-auth.module';
import { DeviceController } from './device.controller';
import { DeviceActivationController } from './device-activation.controller';
import { DeviceRepository } from './device.repository';
import { DeviceService } from './device.service';

@Module({
  imports: [MerchantModule, PosAuthModule],
  controllers: [DeviceController, DeviceActivationController],
  providers: [DeviceService, DeviceRepository],
  exports: [DeviceService],
})
export class DeviceModule {}
