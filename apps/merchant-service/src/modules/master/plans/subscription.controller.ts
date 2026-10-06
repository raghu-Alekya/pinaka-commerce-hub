import { Body, Controller, Delete, Get, Inject, NotFoundException, BadRequestException, Param, Patch, Post, Put, Query, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { CreateSubscriptionDto, SubscriptionFieldsDto } from './subscription.dto';
import { SubscriptionEntity } from '../../../entities/subscription.entity';
const validate = (expectedType: typeof SubscriptionFieldsDto) => new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true, expectedType });
@Controller('api/v1/subscriptions')
export class SubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  private present(row: any) {
    const plan = row.plan || {};
    const storeType = row.storeType || plan.storeType || null;
    return {
      id: row.id,
      subscriptionCode: row.subscriptionCode || row.subscription_code || row.id,
      merchantId: row.merchantId || row.merchant_id,
      status: row.status,
      billingCycle: row.billingCycle || row.billing_cycle,
      price: Number(row.price || 0),
      autoRenew: row.autoRenew ?? row.auto_renew ?? true,
      startDate: row.startDate || row.start_date || null,
      renewalDate: row.renewalDate || row.renewal_date || null,
      plan: plan.id ? {
        id: plan.id,
        planCode: plan.planCode || plan.plan_code,
        name: plan.name,
        basePrice: Number(plan.basePrice ?? plan.base_price ?? 0),
        currency: plan.currency,
        billingCycle: plan.billingCycle || plan.billing_cycle,
        includedStores: Number(plan.includedStores ?? plan.included_stores ?? 0),
        includedTerminals: Number(plan.includedTerminals ?? plan.included_terminals ?? 0),
      } : null,
      storeType: storeType ? {
        id: storeType.id,
        code: storeType.code || storeType.storeTypeCode || storeType.store_type_code,
        name: storeType.name,
      } : null,
    };
  }

  @Get()
  async list(@Query('merchantId') merchantId?: string) {
    const subscriptions = (await this.repository.listSubscriptions(merchantId))
      .filter(row => String(row.status || '').trim().toUpperCase() === 'ACTIVE')
      .map(row => this.present(row));
    return { success:true, count:subscriptions.length, subscriptions };
  }
  @Get(':id')
  async get(@Param('id') id: string) {
    const subscription = await this.repository.getSubscription(id);
    if (!subscription || String(subscription.status).toUpperCase() !== 'ACTIVE' || subscription.isDeleted) {
      throw new NotFoundException('Active subscription not found');
    }
    return { success:true, subscription:this.present(subscription) };
  }
  @Post()
  async create(@Body(validate(CreateSubscriptionDto)) body: CreateSubscriptionDto) {
    if (!(await this.repository.getMerchantById(body.merchantId)).merchant) throw new NotFoundException('Merchant not found');
    if (!body.planId && !body.planCode) throw new BadRequestException('planId is required (planCode is accepted for legacy clients)');
    const fields = await this.repository.prepareSubscriptionContract(body);
    const id = body.id || `SUB-${randomUUID()}`;
    const subscription = await this.repository.insertSubscription({ ...fields, id,
      subscriptionCode:body.subscriptionCode || id, merchantId:body.merchantId, createdAt:new Date(), updatedAt:new Date() } as SubscriptionEntity);
    return { success:true, subscription };
  }
  @Put(':id')
  async replace(@Param('id') id:string, @Body(validate(SubscriptionFieldsDto)) body:SubscriptionFieldsDto) {
    for (const key of ['status','billingCycle','price'] as const) if (body[key] === undefined) throw new BadRequestException(`${key} is required for PUT`);
    if (!body.planId && !body.planCode) throw new BadRequestException('planId is required for PUT');
    return this.save(id,body,true);
  }
  @Patch(':id')
  async update(@Param('id') id:string, @Body(validate(SubscriptionFieldsDto)) body:SubscriptionFieldsDto) { return this.save(id,body); }
  private async save(id:string, body:SubscriptionFieldsDto, replace=false) {
    if (!Object.values(body).some(value => value !== undefined)) throw new BadRequestException('Provide at least one field to update');
    const existing = await this.repository.getSubscription(id);
    if (!existing) throw new NotFoundException('Subscription not found');
    const fields = await this.repository.prepareSubscriptionContract(body,replace ? undefined : existing);
    const subscription = await this.repository.updateSubscription(id,fields);
    if (!subscription) throw new NotFoundException('Subscription not found');
    return {success:true,subscription};
  }
  @Delete(':id')
  async remove(@Param('id') id:string) {
    if (!(await this.repository.deleteSubscription(id))) throw new NotFoundException('Subscription not found');
    return {success:true,message:'Subscription deleted'};
  }
}
