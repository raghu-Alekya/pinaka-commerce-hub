import { Injectable, NotImplementedException } from '@nestjs/common';
import { DashboardFiltersDto } from './dto/dashboard_filters.dto';
import { DashboardSummaryResponseDto } from './dto/dashboard_summary_response.dto';

@Injectable()
export class DashboardService {
  get_summary(_filters: DashboardFiltersDto): Promise<DashboardSummaryResponseDto> {
    throw new NotImplementedException(
      'Dashboard summary data provider is not configured. See dashboard/README.md.',
    );
  }
}
