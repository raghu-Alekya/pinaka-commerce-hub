import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { assertConsoleMerchant, extractBearerToken, verifyAccessToken } from '@pch/auth';
import { CreatePaymentService } from './create-payment.service';

@Controller([
  'api/v1/payments',
  'connector/api/v1/payments',
])
export class CreatePaymentController {
  constructor(@Inject(CreatePaymentService) private readonly payments: CreatePaymentService) {}

  @Post('create-payment')
  @HttpCode(HttpStatus.OK)
  create(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    const token = verifyAccessToken(extractBearerToken(authorization));
    const merchant = String(merchantId || '').trim();
    assertConsoleMerchant(token, merchant);
    const store = String(storeId || '').trim();
    if (!merchant) throw new BadRequestException('x-merchant-id header is required');
    if (!store) throw new BadRequestException('x-store-id header is required');
    return this.payments.create(body ?? {}, {
      merchantId: merchant,
      storeId: store,
      userId: token.sub,
    });
  }
}
