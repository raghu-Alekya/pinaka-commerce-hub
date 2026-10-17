import { Injectable, NotImplementedException } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { PlansEntitlementsResponseDto } from './dto/plans_entitlements_response.dto';

@Injectable()
export class PlansEntitlementsService {
  get_plans_entitlements(_filters: DashboardFiltersDto): Promise<PlansEntitlementsResponseDto> {
    throw new NotImplementedException(
      'Plans and entitlements data provider is not configured. See dashboard/README.md.',
    );
  }
}
