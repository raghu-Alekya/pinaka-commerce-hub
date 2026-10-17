import { Controller, Get, Query } from '@nestjs/common';
import { DashboardFiltersDto } from './dto/dashboard_filters.dto';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryResponseDto } from './dto/dashboard_summary_response.dto';
import { PlansEntitlementsService } from './plans-entitlements/plans-entitlements.service';
import { RolesPermissionsService } from './roles-permissions/roles-permissions.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';


@Controller([
  'api/v1/dashboard',
  'connectors/api/v1/dashboard',
  'api/v1/admin/dashboard',
])
export class DashboardController {
  constructor(private readonly dashboard_service: DashboardService) {}

  @Get('summary')
  get_summary(@Query() filters: DashboardFiltersDto): Promise<DashboardSummaryResponseDto> {
    return this.dashboard_service.get_summary(filters);
  }
}
