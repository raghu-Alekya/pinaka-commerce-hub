import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { PlansEntitlementsService } from './plans-entitlements/plans-entitlements.service';
import { RolesPermissionsService } from './roles-permissions/roles-permissions.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';

@Controller([
  'api/v1/dashboard',
  'connectors/api/v1/dashboard',
  'api/v1/admin/dashboard',
])
@UseGuards(DashboardAuthGuard)
export class DashboardController {
  constructor(
    @Inject(PlansEntitlementsService) private readonly plansEntitlements: PlansEntitlementsService,
    @Inject(RolesPermissionsService) private readonly rolesPermissions: RolesPermissionsService,
  ) {}

  @Get()
  getDashboardSummary() {
    return Promise.all([
      this.plansEntitlements.getSummary(),
      this.rolesPermissions.getSummary(),
    ]).then(([plansEntitlements, rolesPermissions]) => ({
      plansEntitlements,
      rolesPermissions,
      generatedAt: new Date().toISOString(),
    }));
  }

}
