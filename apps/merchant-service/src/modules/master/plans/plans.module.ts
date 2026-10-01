import { Module } from '@nestjs/common';
import {
  PlanController as LegacyPlanController,
} from '../../master/common/master-data.controller';
import { CompactSubscriptionController } from './compact-subscription.controller';
import { MerchantPlanFeaturesController } from './merchant-plan-features.controller';
import { SubscriptionPlanChangeController } from './subscription-plan-change.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { MerchantModule } from '../../merchant/merchant.module';

@Module({
  imports: [MerchantModule],
  controllers: [
    LegacyPlanController,
    CompactSubscriptionController,
    SubscriptionPlanChangeController,
    SubscriptionPlanController,
    MerchantPlanFeaturesController,
  ],
})
export class PlansModule {}
