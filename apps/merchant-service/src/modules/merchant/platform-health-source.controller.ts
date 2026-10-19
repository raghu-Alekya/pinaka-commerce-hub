import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PlatformHealthSourceService } from './platform-health-source.service';

@Controller('api/v1/dashboard/platform-health')
export class PlatformHealthSourceController {
  constructor(
    @Inject(PlatformHealthSourceService)
    private readonly platformHealth: PlatformHealthSourceService,
  ) {}

  @Get('source-metrics')
  getSourceMetrics(@Query() filters: { merchant_id?: string; store_id?: string }) {
    return this.platformHealth.getSourceMetrics(filters);
  }
}
