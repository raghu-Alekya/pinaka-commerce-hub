import { Injectable, NotImplementedException } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { RolesPermissionsResponseDto } from './dto/roles_permissions_response.dto';

@Injectable()
export class RolesPermissionsService {
  get_roles_permissions(_filters: DashboardFiltersDto): Promise<RolesPermissionsResponseDto> {
    throw new NotImplementedException(
      'Roles and permissions data provider is not configured. See dashboard/README.md.',
    );
  }
}
