import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { MerchantRepository } from './merchant.repository';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { ReferenceDataController } from './reference-data.controller';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  imports: [],
  controllers: [
    AppController,
    SubscriptionController,
    SubscriptionPlanController,
    ReferenceDataController,
  ],
  providers: [
    MerchantRepository,
    SessionAuthGuard,
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
  ],
})
export class AppModule {}
