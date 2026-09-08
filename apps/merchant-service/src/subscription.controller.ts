import { Body, Controller, Delete, Get, Inject, NotFoundException, BadRequestException, Param, Patch, Post, Put, Query, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from './merchant.repository';
import { CreateSubscriptionDto, SubscriptionFieldsDto } from './subscription.dto';
import { SubscriptionEntity } from './entities/subscription.entity';

@Controller('api/v1/subscriptions')
export class SubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Query('merchantId') merchantId?: string) {
    const subscriptions = await this.repository.listSubscriptions(merchantId);
    return { success: true, count: subscriptions.length, subscriptions };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const subscription = await this.repository.getSubscription(id);
    if (!subscription) throw new NotFoundException('Subscription not found');
    return { success: true, subscription };
  }

  @Post()
  async create(@Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: CreateSubscriptionDto })) body: CreateSubscriptionDto) {
    if (!(await this.repository.getMerchantById(body.merchantId)).merchant) throw new NotFoundException('Merchant not found');
    const fields = this.fields(body);
    this.validateDates(fields);
    const subscription = await this.repository.insertSubscription({ ...fields, id: body.id || `SUB-${randomUUID()}`,
      merchantId: body.merchantId, createdAt: new Date(), updatedAt: new Date() } as SubscriptionEntity);
    return { success: true, subscription };
  }

  @Put(':id')
  async replace(@Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: SubscriptionFieldsDto })) body: SubscriptionFieldsDto) {
    return this.save(id, body);
  }

  @Patch(':id')
  async update(@Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, skipUndefinedProperties: true, expectedType: SubscriptionFieldsDto })) body: SubscriptionFieldsDto) {
    return this.save(id, body);
  }

  private async save(id: string, body: SubscriptionFieldsDto) {
    const existing = await this.repository.getSubscription(id);
    if (!existing) throw new NotFoundException('Subscription not found');
    const fields = this.fields(body);
    this.validateDates({ ...existing, ...fields });
    const subscription = await this.repository.updateSubscription(id, fields);
    if (!subscription) throw new NotFoundException('Subscription not found');
    return { success: true, subscription };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (!(await this.repository.deleteSubscription(id))) throw new NotFoundException('Subscription not found');
    return { success: true, message: 'Subscription deleted' };
  }

  private fields(body: SubscriptionFieldsDto): Partial<SubscriptionEntity> {
    const { currentPeriodStart, currentPeriodEnd, ...rest } = body;
    return { ...Object.fromEntries(Object.entries(rest).filter(([key, value]) => value !== undefined && key !== 'id' && key !== 'merchantId')),
      ...(currentPeriodStart !== undefined ? { currentPeriodStart: new Date(currentPeriodStart) } : {}),
      ...(currentPeriodEnd !== undefined ? { currentPeriodEnd: new Date(currentPeriodEnd) } : {}) };
  }

  private validateDates(fields: Partial<SubscriptionEntity>) {
    if (fields.currentPeriodStart && fields.currentPeriodEnd && fields.currentPeriodEnd <= fields.currentPeriodStart) {
      throw new BadRequestException('currentPeriodEnd must be after currentPeriodStart');
    }
  }
}
