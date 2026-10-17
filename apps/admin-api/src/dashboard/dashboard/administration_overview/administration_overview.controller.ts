import { Controller, Get, Query } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { AdministrationOverviewResponseDto } from './dto/administration_overview_response.dto';
import { AdministrationOverviewService } from './administration_overview.service';

@Controller('api/v1/admin/dashboard')
export class AdministrationOverviewController {
  constructor(private readonly administration_overview_service: AdministrationOverviewService) {}

  @Get('administration-overview')
  get_administration_overview(@Query() filters: DashboardFiltersDto): Promise<AdministrationOverviewResponseDto> {
    return this.administration_overview_service.get_administration_overview(filters);
  }
}
