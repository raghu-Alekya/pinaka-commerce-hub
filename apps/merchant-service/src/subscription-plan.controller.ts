import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, ValidationPipe } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { CreateSubscriptionPlanDto, SubscriptionPlanFieldsDto } from './subscription-plan.dto';

@Controller('api/v1/subscription-plans')
export class SubscriptionPlanController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list() {
    const plans = await this.repository.listSubscriptionPlans();
    return { success: true, count: plans.length, plans };
  }

  @Get(':planCode')
  async get(@Param('planCode') code: string) {
    const plan = await this.repository.getSubscriptionPlan(code.toUpperCase());
    if (!plan) throw new NotFoundException('Subscription plan not found');
    return { success: true, plan };
  }

  @Post()
  async create(@Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: CreateSubscriptionPlanDto })) body: CreateSubscriptionPlanDto) {
    const plan = await this.repository.createSubscriptionPlan({ ...body, description: body.description || '', createdAt: new Date(), updatedAt: new Date() });
    return { success: true, plan };
  }

  @Put(':planCode')
  async replace(@Param('planCode') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: SubscriptionPlanFieldsDto })) body: SubscriptionPlanFieldsDto) {
    return this.save(code, { ...body, description: body.description || '' });
  }

  @Patch(':planCode')
  async patch(@Param('planCode') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, skipUndefinedProperties: true, expectedType: SubscriptionPlanFieldsDto })) body: SubscriptionPlanFieldsDto) {
    return this.save(code, body);
  }

  private async save(code: string, body: SubscriptionPlanFieldsDto) {
    const fields = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
    const plan = await this.repository.updateSubscriptionPlan(code.toUpperCase(), fields);
    if (!plan) throw new NotFoundException('Subscription plan not found');
    return { success: true, plan };
  }

  @Delete(':planCode')
  async remove(@Param('planCode') code: string) {
    if (!(await this.repository.deleteSubscriptionPlan(code.toUpperCase()))) throw new NotFoundException('Subscription plan not found');
    return { success: true, message: 'Subscription plan deleted' };
  }
}
