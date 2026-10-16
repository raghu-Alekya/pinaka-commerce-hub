import { Module } from '@nestjs/common';
import { PlanController, PlanWriteGuard } from './plan.controller';
import { PlanRepository } from './plan.repository';
import { CompactSubscriptionController } from './compact-subscription.controller';
import { MerchantPlanFeaturesController } from './merchant-plan-features.controller';
import { SubscriptionPlanChangeController } from './subscription-plan-change.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { MerchantModule } from '../../merchant/merchant.module';

@Module({
  imports: [MerchantModule],
  providers: [PlanRepository, PlanWriteGuard],
  controllers: [
    PlanController,
    CompactSubscriptionController,
    SubscriptionPlanChangeController,
    SubscriptionPlanController,
    MerchantPlanFeaturesController,
  ],
})
export class PlansModule {}
