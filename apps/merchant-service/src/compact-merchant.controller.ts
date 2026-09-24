import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { MerchantCrudService } from './merchant-crud.service';
@Controller('api/v1/merchants')
export class CompactMerchantController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  private get service() { return new MerchantCrudService(this.repository.requireDataSource()); }
  @Post('create-merchant')
  createFromOnboarding(@Body() body: Record<string, any>) {
    if (body && typeof body==='object' && !('merchant' in body) && !('subscription' in body)) return this.service.createMerchant(body);
    if (!body?.merchant || !body?.subscription) throw new BadRequestException('merchant and subscription are required');
    if (Object.keys(body).some(key=>!['merchant','subscription','stores','roleIds'].includes(key))) throw new BadRequestException('Unknown onboarding field');
    if (body.stores !== undefined && (!Array.isArray(body.stores) || body.stores.length)) throw new BadRequestException('stores must be an empty array');
    const subscriptionKeys = ['planId','billingCycle','startDate','renewalDate','agreementPrice'];
    if (typeof body.subscription !== 'object' || Array.isArray(body.subscription) || Object.keys(body.subscription).some(key=>!subscriptionKeys.includes(key))) throw new BadRequestException('Invalid subscription fields');
    if (typeof body.merchant !== 'object' || Array.isArray(body.merchant)) throw new BadRequestException('Invalid merchant');
    if (subscriptionKeys.some(key=>key in body.merchant)) throw new BadRequestException('Subscription fields belong in subscription');
    return this.service.createMerchant({...body.merchant,...body.subscription,roleIds:body.roleIds || []});
  }
  @Post() create(@Body() body: Record<string, unknown>) { return this.service.createMerchant(body); }
  @Get() list() { return this.service.listMerchants(); }
  @Get(':id/history') history(@Param('id') id: string) { return this.service.history(id); }
  @Get(':id') get(@Param('id') id: string) { return this.service.getMerchant(id); }
  @Put(':id') replace(@Param('id') id: string,@Body() body: Record<string, unknown>) { return this.service.updateMerchant(id,body,true); }
  @Patch(':id') patch(@Param('id') id: string,@Body() body: Record<string, unknown>) { return this.service.updateMerchant(id,body); }
  @Patch(':id/status') updateStatus(@Param('id') id: string,@Body() body: Record<string, unknown>) {
    if (!body || Object.keys(body).some(key=>key!=='status') || !['ACTIVE','INACTIVE','PENDING','SUSPENDED'].includes(String(body.status))) throw new BadRequestException('Invalid merchant status');
    return this.service.updateMerchant(id,body);
  }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteMerchant(id); }
}
