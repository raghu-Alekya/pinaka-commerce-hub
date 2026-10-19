import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CompactMerchantController } from './compact-merchant.controller';
import { CountriesController } from './countries.controller';
import { MerchantCrudService } from './merchant-crud.service';
import { MerchantRepository } from './merchant.repository';
import { MerchantResponseRelationsInterceptor } from './merchant-response-relations.interceptor';
import { OnboardingController } from './onboarding.controller';
import { ReferenceDataController } from './reference-data.controller';
import { SessionAuthGuard } from '../shared/session-auth.guard';
import { PlatformHealthSourceController } from './platform-health-source.controller';
import { PlatformHealthSourceService } from './platform-health-source.service';

@Module({
  controllers: [
    CompactMerchantController,
    CountriesController,
    OnboardingController,
    ReferenceDataController,
    PlatformHealthSourceController,
  ],
  providers: [
    MerchantRepository,
    MerchantCrudService,
    PlatformHealthSourceService,
    SessionAuthGuard,
    {
      provide: APP_GUARD,
      useExisting: SessionAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MerchantResponseRelationsInterceptor,
    },
  ],
  exports: [MerchantRepository],
})
export class MerchantModule {}
