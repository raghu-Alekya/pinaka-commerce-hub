import { Controller, Get, Headers, Inject, Query, UseGuards } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { DashboardFeaturesResponseDto } from './dto/dashboard_features_response.dto';
import { DashboardFeaturesService } from './dashboard_features.service';
import { DashboardAuthGuard } from '../dashboard-auth.guard';

@Controller('api/v1/admin/dashboard')
@UseGuards(DashboardAuthGuard)
export class DashboardFeaturesController {
  constructor(
    @Inject(DashboardFeaturesService)
    private readonly dashboard_features_service: DashboardFeaturesService,
  ) {}

  @Get('features')
  get_features(
    @Query() filters: DashboardFiltersDto,
    @Headers('authorization') authorization?: string,
  ): Promise<DashboardFeaturesResponseDto> {
    return this.dashboard_features_service.get_features(filters, authorization);
  }
}
