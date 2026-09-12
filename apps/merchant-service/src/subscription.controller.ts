import { Body, Controller, Delete, Get, Inject, NotFoundException, BadRequestException, Param, Patch, Post, Put, Query, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from './merchant.repository';
import { CreateSubscriptionDto, SubscriptionFieldsDto } from './subscription.dto';
import { SubscriptionEntity } from './entities/subscription.entity';
const validate = (expectedType: typeof SubscriptionFieldsDto) => new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true, expectedType });
@Controller('api/v1/subscriptions')
export class SubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get()
  async list(@Query('merchantId') merchantId?: string) {
    const subscriptions = await this.repository.listSubscriptions(merchantId);
    return { success:true, count:subscriptions.length, subscriptions };
  }
  @Get(':id')
  async get(@Param('id') id: string) {
    const subscription = await this.repository.getSubscription(id);
    if (!subscription) throw new NotFoundException('Subscription not found');
    return { success:true, subscription };
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
