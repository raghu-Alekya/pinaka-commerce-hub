import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { DashboardAuthGuard } from '../dashboard-auth.guard';
import { AdministrationOverviewService } from './dto/administration-overview-service-interface';
import { AdministrationOverviewQueryDto } from './dto/administration-overview-query.dto';
import { AdministrationOverviewResponseDto } from './dto/administration-overview-response.dto';

@Controller([
  'api/v1/admin/administration-overview',
  'connector/api/v1/admin/administration-overview',
  'admin/administration-overview',
])
@UseGuards(DashboardAuthGuard)
export class AdministrationOverviewController {
  constructor(
    @Inject(AdministrationOverviewService)
    private readonly overviewService: AdministrationOverviewService,
  ) {}

  @Get()
  async getOverview(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    query: AdministrationOverviewQueryDto,
  ): Promise<AdministrationOverviewResponseDto> {
    return this.overviewService.getOverview(query);
  }
}
