import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MerchantRepository } from './merchant.repository';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { ReferenceDataController } from './reference-data.controller';
@Module({ imports: [], controllers: [AppController, SubscriptionController, SubscriptionPlanController, ReferenceDataController], providers: [MerchantRepository] })
export class AppModule {}
