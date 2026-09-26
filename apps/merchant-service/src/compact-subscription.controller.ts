import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { MerchantCrudService } from './merchant-crud.service';
import { SubscriptionPlanChangeController } from './subscription-plan-change.controller';
@Controller(['api/v1/subscriptions', 'connector/api/v1/subscriptions'])
export class CompactSubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  private get service() { return new MerchantCrudService(this.repository.requireDataSource()); }
  @Get() list(@Query('merchantId') merchantId?: string,@Query('status') status?: string) { return this.service.listSubscriptions(merchantId,status); }
  @Get('active')
  active(@Query('merchantId') merchantId?: string) { return this.service.listSubscriptions(merchantId, 'ACTIVE'); }
  @Post('subscription-plan-changes')
  planChange(@Body() body: Record<string, unknown>) { return new SubscriptionPlanChangeController(this.repository).change(body); }
  @Get(':id') get(@Param('id') id: string) { return this.service.getSubscription(id); }
  @Post() create(@Body() body: Record<string, unknown>) { return this.service.saveSubscription(body); }
  @Put(':id') replace(@Param('id') id: string,@Body() body: Record<string, unknown>) { return this.service.saveSubscription(body,id,true); }
  @Patch(':id') patch(@Param('id') id: string,@Body() body: Record<string, unknown>) { return this.service.saveSubscription(body,id); }
  @Patch(':id/status') updateStatus(@Param('id') id: string,@Body() body: Record<string, unknown>) {
    if (!body || Object.keys(body).some(key=>key!=='status') || !body.status) throw new BadRequestException('Provide status only');
    return this.service.saveSubscription(body,id);
  }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteSubscription(id); }
}
