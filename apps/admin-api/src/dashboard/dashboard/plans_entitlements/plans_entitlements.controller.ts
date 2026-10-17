import { Controller, Get, Query } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { PlansEntitlementsResponseDto } from './dto/plans_entitlements_response.dto';
import { PlansEntitlementsService } from './plans_entitlements.service';

@Controller('api/v1/admin/dashboard')
export class PlansEntitlementsController {
  constructor(private readonly plans_entitlements_service: PlansEntitlementsService) {}

  @Get('plans-entitlements')
  get_plans_entitlements(@Query() filters: DashboardFiltersDto): Promise<PlansEntitlementsResponseDto> {
    return this.plans_entitlements_service.get_plans_entitlements(filters);
  }
}
