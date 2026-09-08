import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MerchantRepository } from './merchant.repository';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';

@Module({
  imports: [],
  controllers: [AppController, SubscriptionController, SubscriptionPlanController],
  providers: [MerchantRepository],
})
export class AppModule {}
