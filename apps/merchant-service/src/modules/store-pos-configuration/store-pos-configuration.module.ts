import { Module } from '@nestjs/common';

import { MerchantModule } from '../merchant/merchant.module';
import { StorePosConfigurationController } from './store-pos-configuration.controller';
import { StorePosConfigurationsService } from './store-pos-configuration.service';
import { DeviceMappingsModule } from './device-mappings/device-mappings.module';

/**
 * Uses the merchant DataSource. TypeOrmModule.forFeature cannot resolve a
 * repository here because this service never calls TypeOrmModule.forRoot.
 */
@Module({
  imports: [MerchantModule, DeviceMappingsModule],
  controllers: [StorePosConfigurationController],
  providers: [StorePosConfigurationsService],
  exports: [StorePosConfigurationsService],
})
export class StorePosConfigurationModule {}
