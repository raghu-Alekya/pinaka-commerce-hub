import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { MerchantCrudService } from '../../merchant/merchant-crud.service';
import { SubscriptionPlanChangeController } from './subscription-plan-change.controller';
import { isWebConsoleRequest, sameMerchant } from '../../shared/console-access';
type ConsoleRequest = { headers?: { 'x-pch-web-console'?: string }; user?: { accountType?: string; merchantId?: string; merchantCode?: string } };
@Controller(['api/v1/subscriptions', 'connector/api/v1/subscriptions'])
export class CompactSubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  private get service() { return new MerchantCrudService(this.repository.requireDataSource()); }
  private scopedMerchant(request: ConsoleRequest): string | undefined {
    if (!isWebConsoleRequest(request)) return undefined;
    const user = request.user;
    if (user?.accountType !== 'merchant' && user?.accountType !== 'employee') return undefined;
    if (!user.merchantId) throw new ForbiddenException('Merchant session is missing its merchant ID');
    return user.merchantId;
  }
  private assertMerchant(request: ConsoleRequest, merchantId?: string): string | undefined {
    const scoped = this.scopedMerchant(request);
    if (scoped && merchantId && ![scoped, request.user?.merchantCode].some(value => value?.toLowerCase() === merchantId.toLowerCase())) {
      throw new ForbiddenException('You can only access your own subscriptions');
    }
    return scoped;
  }
  private async ownedSubscription(id: string, request: ConsoleRequest) {
    const result = await this.service.getSubscription(id);
    const scoped = this.scopedMerchant(request);
    const owner = String(result.subscription?.merchantUuid || result.subscription?.merchantId || '');
    if (scoped && (!owner || !sameMerchant(owner, scoped, request.user?.merchantCode))) {
      throw new NotFoundException('Subscription not found');
    }
    return result;
  }
  @Get() list(@Query('merchantId') merchantId?: string,@Query('status') status?: string,@Req() request?: ConsoleRequest) {
    const scope = this.assertMerchant(request || {}, merchantId);
    return this.service.listSubscriptions(scope || merchantId, status?.trim() || undefined);
  }
  @Get('active')
  active(@Query('merchantId') merchantId?: string,@Req() request?: ConsoleRequest) {
    const scope = this.assertMerchant(request || {}, merchantId);
    return this.service.listSubscriptions(scope || merchantId, 'ACTIVE');
  }
  @Post('subscription-plan-changes')
  planChange(@Body() body: Record<string, unknown>,@Req() request: ConsoleRequest) { return new SubscriptionPlanChangeController(this.repository).change(body, request); }
  @Get(':id') get(@Param('id') id: string,@Req() request: ConsoleRequest) { return this.ownedSubscription(id, request); }
  @Post() create(@Body() body: Record<string, unknown>,@Req() request: ConsoleRequest) {
    const scope = this.assertMerchant(request, String(body?.merchantId || ''));
    return this.service.saveSubscription(scope ? { ...body, merchantId: scope } : body);
  }
  @Put(':id') async replace(@Param('id') id: string,@Body() body: Record<string, unknown>,@Req() request: ConsoleRequest) {
    await this.ownedSubscription(id, request);
    return this.service.saveSubscription(body,id,true);
  }
  @Patch(':id') async patch(@Param('id') id: string,@Body() body: Record<string, unknown>,@Req() request: ConsoleRequest) {
    await this.ownedSubscription(id, request);
    return this.service.saveSubscription(body,id);
  }
  @Patch(':id/status') async updateStatus(@Param('id') id: string,@Body() body: Record<string, unknown>,@Req() request: ConsoleRequest) {
    await this.ownedSubscription(id, request);
    if (!body || Object.keys(body).some(key=>key!=='status') || !body.status) throw new BadRequestException('Provide status only');
    return this.service.saveSubscription(body,id);
  }
  @Delete(':id') async remove(@Param('id') id: string,@Req() request: ConsoleRequest) {
    await this.ownedSubscription(id, request);
    return this.service.deleteSubscription(id);
  }
}
