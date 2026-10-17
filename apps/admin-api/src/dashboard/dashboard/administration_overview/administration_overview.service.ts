import { Injectable, NotImplementedException } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { AdministrationOverviewResponseDto } from './dto/administration_overview_response.dto';

@Injectable()
export class AdministrationOverviewService {
  get_administration_overview(_filters: DashboardFiltersDto): Promise<AdministrationOverviewResponseDto> {
    throw new NotImplementedException(
      'Administration overview data provider is not configured. See dashboard/README.md.',
    );
  }
}
