import { Controller, Get, Query } from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { RolesPermissionsResponseDto } from './dto/roles_permissions_response.dto';
import { RolesPermissionsService } from './roles_permissions.service';

@Controller('api/v1/admin/dashboard')
export class RolesPermissionsController {
  constructor(private readonly roles_permissions_service: RolesPermissionsService) {}

  @Get('roles-permissions')
  get_roles_permissions(@Query() filters: DashboardFiltersDto): Promise<RolesPermissionsResponseDto> {
    return this.roles_permissions_service.get_roles_permissions(filters);
  }
}
