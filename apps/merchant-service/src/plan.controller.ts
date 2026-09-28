import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto';
import { filterMasterList } from './master-list';

@Public()
@Controller(['api/v1/plans', 'connector/api/v1/plans', 'plans'])
export class PlanController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const plans = filterMasterList(await this.repository.listPlans(), query);
    return { success: true, count: plans.length, plans };
  }

  @Get(':idOrCode')
  async get(@Param('idOrCode') idOrCode: string) {
    const plan = await this.repository.getPlanByIdOrCode(idOrCode);
    if (!plan) throw new NotFoundException(`Plan '${idOrCode}' not found`);
    return { success: true, plan };
  }

  @Post()
  async create(@Body() body: CreatePlanDto) {
    const existing = await this.repository.getPlanByIdOrCode(body.planCode);
    if (existing) throw new ConflictException(`Plan code '${body.planCode}' already exists`);
    const plan = await this.repository.createPlan(body);
    return { success: true, message: 'Commercial plan created successfully', plan };
  }

  @Put(':idOrCode')
  async update(@Param('idOrCode') idOrCode: string, @Body() body: UpdatePlanDto) {
    const updated = await this.repository.updatePlan(idOrCode, body);
    if (!updated) throw new NotFoundException(`Plan '${idOrCode}' not found`);
    return { success: true, message: 'Commercial plan updated successfully', plan: updated };
  }

  @Delete(':idOrCode')
  async delete(@Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deletePlan(idOrCode);
    if (!deleted) throw new NotFoundException(`Plan '${idOrCode}' not found`);
    return { success: true, message: 'Commercial plan deactivated successfully' };
  }
}
