import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { RolesPermissionsService } from './roles-permissions.service';
import { DashboardAuthGuard } from '../dashboard-auth.guard';

@Controller([
  'api/v1/dashboard/roles-permissions',
  'connectors/api/v1/dashboard/roles-permissions',
  'api/v1/admin/dashboard/roles-permissions',
])
@UseGuards(DashboardAuthGuard)
export class RolesPermissionsController {
  constructor(@Inject(RolesPermissionsService) private readonly service: RolesPermissionsService) {}

  @Get()
  getSummary() {
    return this.service.getSummary();
  }
}
