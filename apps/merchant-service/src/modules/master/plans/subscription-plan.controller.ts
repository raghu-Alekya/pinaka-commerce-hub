import { All, Controller, GoneException } from '@nestjs/common';

@Controller(['api/v1/subscription-plans', 'connector/api/v1/subscription-plans', 'subscription-plans'])
export class SubscriptionPlanController {
  @All(['', ':planCode'])
  retired(): never {
    throw new GoneException('Subscription plan catalog retired. Use the plans API.');
  }
}
