import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorePosConfigurationEntity } from '../../entities/store-pos-configuration.entity';
import { StorePosConfigurationController } from './store-pos-configuration.controller';
import { StorePosConfigurationsService } from './store-pos-configuration.service';

/**
 * Registered from AppModule so the service can use MerchantRepository.
 * This service does not call TypeOrmModule.forRoot, so forFeature() cannot resolve DataSource.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StorePosConfigurationEntity,
    ]),
  ],

  controllers: [
    StorePosConfigurationController,
  ],
  providers: [
    StorePosConfigurationsService,
  ],
  exports: [
    StorePosConfigurationsService,
  ],
})
export class StorePosConfigurationModule {}
