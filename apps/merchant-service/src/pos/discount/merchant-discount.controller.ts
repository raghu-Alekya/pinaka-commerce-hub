import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { RequireAuth } from '../../modules/shared/session-auth.guard';
import { DiscountService } from './discount.service';

type MerchantRequest = { user?: { id?: string; merchantId?: string; storeId?: string; role?: string } };

/** Merchant-token discount API. Store ownership is checked against the token's merchantId. */
@Controller([
  'api/v1/stores/:storeId/merchant/discounts',
  'connector/api/v1/stores/:storeId/merchant/discounts',
])
@RequireAuth()
export class MerchantDiscountController {
  constructor(@Inject(DiscountService) private readonly discounts: DiscountService) {}

  private async storeId(storeId: string, request: MerchantRequest) {
    const store = await this.discounts.resolveMerchantStore(storeId, request.user);
    return store.id;
  }

  @Get()
  @HttpCode(200)
  async list(@Param('storeId') storeId: string, @Query() query: Record<string, string>, @Req() request: MerchantRequest) {
    const id = await this.storeId(storeId, request);
    return this.discounts.list(id, 'MERCHANT_ADMIN', query);
  }

  @Get(':type/:id')
  @HttpCode(200)
  async getById(@Param('storeId') storeId: string, @Param('type') type: string, @Param('id') id: string, @Req() request: MerchantRequest) {
    const scopedStoreId = await this.storeId(storeId, request);
    return this.discounts.getById(scopedStoreId, type, id, 'MERCHANT_ADMIN');
  }

  @Post()
  @HttpCode(201)
  async create(@Param('storeId') storeId: string, @Body() body: Record<string, any>, @Req() request: MerchantRequest) {
    const id = await this.storeId(storeId, request);
    return this.discounts.create(id, body, 'MERCHANT_ADMIN');
  }

  @Put(':type/:id')
  @HttpCode(200)
  async update(@Param('storeId') storeId: string, @Param('type') type: string, @Param('id') id: string, @Body() body: Record<string, any>, @Req() request: MerchantRequest) {
    const scopedStoreId = await this.storeId(storeId, request);
    return this.discounts.update(scopedStoreId, type, id, body, 'MERCHANT_ADMIN');
  }

  @Delete(':type/:id')
  @HttpCode(200)
  async remove(@Param('storeId') storeId: string, @Param('type') type: string, @Param('id') id: string, @Req() request: MerchantRequest) {
    const scopedStoreId = await this.storeId(storeId, request);
    return this.discounts.remove(scopedStoreId, type, id, 'MERCHANT_ADMIN');
  }
}
