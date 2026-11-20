import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { extractBearerToken, verifyAccessToken } from '@pch/auth';
import { LoyaltyService } from './loyalty.service';

@Controller([
  'api/v1/loyalty',
  'connector/api/v1/loyalty',
  'pinaka-pos/v1/loyalty',
  'wp-json/pinaka-pos/v1/loyalty',
])
export class LoyaltyController {
  constructor(@Inject(LoyaltyService) private readonly loyalty: LoyaltyService) {}

  @Get('get-loyalty-points')
  getPoints(
    @Query('contact') contact?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.getPoints(contact, this.scope(authorization, merchantId, storeId));
  }

  @Post('create-customer')
  @HttpCode(HttpStatus.OK)
  createCustomer(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.createCustomer(body, this.scope(authorization, merchantId, storeId));
  }

  @Post('add-loyalty-points')
  @HttpCode(HttpStatus.OK)
  addPoints(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.addPoints(body, this.scope(authorization, merchantId, storeId));
  }

  @Post('remove-loyalty-points')
  @HttpCode(HttpStatus.OK)
  removePoints(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.removePoints(body, this.scope(authorization, merchantId, storeId));
  }

  @Get('get-all-customers')
  allCustomers(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.allCustomers(this.scope(authorization, merchantId, storeId));
  }

  @Get('get-settings')
  getSettings(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.getSettings(this.scope(authorization, merchantId, storeId));
  }

  @Post('update-settings')
  @HttpCode(HttpStatus.OK)
  updateSettings(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.loyalty.updateSettings(body, this.scope(authorization, merchantId, storeId));
  }

  private scope(authorization: string | undefined, merchantId: string | undefined, storeId: string | undefined) {
    const token = verifyAccessToken(extractBearerToken(authorization));
    const merchant = String(merchantId || '').trim();
    const store = String(storeId || '').trim();
    if (!merchant) throw new BadRequestException('x-merchant-id header is required');
    if (!store) throw new BadRequestException('x-store-id header is required');
    return { merchantId: merchant, storeId: store, actorId: token.sub };
  }
}
