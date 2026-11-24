import { BadRequestException, Body, Controller, ForbiddenException, Inject, Post, Req } from '@nestjs/common';
import { CompactMerchantController } from '../../merchant/compact-merchant.controller';
import { isWebConsoleRequest } from '../../shared/console-access';
import { MerchantRepository } from '../../merchant/merchant.repository';

type Input = Record<string, unknown>;

@Controller([
  'api/v1/subscriptions/subscription-plan-changes',
  'connector/api/v1/subscriptions/subscription-plan-changes',
  'api/v1/subscription-plan-changes',
  'api/v1/api/v1/subscription-plan-changes',
  'connector/api/v1/subscription-plan-changes',
])
export class SubscriptionPlanChangeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Post()
  async change(@Body() body: Input, @Req() request?: { headers?: { 'x-pch-web-console'?: string }; user?: { accountType?: string; merchantId?: string; merchantCode?: string } }) {
    const merchantId = String(body?.merchantId || '').trim();
    const planId = String(body?.planId || '').trim();
    if (!merchantId || !planId) throw new BadRequestException('merchantId and planId are required');
    const user = request?.user;
    if (isWebConsoleRequest(request) && (user?.accountType === 'merchant' || user?.accountType === 'employee')) {
      if (![user.merchantId, user.merchantCode].some(value => value?.toLowerCase() === merchantId.toLowerCase())) {
        throw new ForbiddenException('You can only change your own subscription');
      }
    }

    const requestedCycle = String(body.billingCycle || 'MONTHLY').trim().toUpperCase();
    const billingCycle = requestedCycle === 'YEARLY' ? 'ANNUAL' : requestedCycle;
    if (!['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(billingCycle)) {
      throw new BadRequestException('Invalid billingCycle');
    }

    const changes: Record<string, unknown> = { planId, billingCycle };
    for (const key of ['startDate', 'renewalDate', 'agreementPrice', 'tax', 'totalDueToday', 'paymentMethod']) {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') changes[key] = body[key];
    }

    // Reuse the existing merchant edit flow, including its store-type checks and
    // subscription versioning, instead of maintaining a second update path.
    const result = await new CompactMerchantController(this.repository)
      .update(merchantId, changes, false);

    return {
      success: true,
      merchantId,
      subscription: result.subscription,
    };
  }
}
