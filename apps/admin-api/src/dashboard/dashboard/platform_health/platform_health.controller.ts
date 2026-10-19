import { Controller, Get, Headers, Inject, Query, UseGuards } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { PlatformHealthResponseDto } from './dto/platform_health_response.dto';
import { PlatformHealthService } from './platform_health.service';
import { DashboardAuthGuard } from '../dashboard-auth.guard';

@Controller('api/v1/admin/dashboard')
@UseGuards(DashboardAuthGuard)
export class PlatformHealthController {
  constructor(
    @Inject(PlatformHealthService)
    private readonly platform_health_service: PlatformHealthService,
  ) {}

  @Get('platform-health')
  get_platform_health(
    @Query() filters: DashboardFiltersDto,
    @Headers('authorization') authorization?: string,
  ): Promise<PlatformHealthResponseDto> {
    return this.platform_health_service.get_platform_health(filters, authorization);
  }
}
