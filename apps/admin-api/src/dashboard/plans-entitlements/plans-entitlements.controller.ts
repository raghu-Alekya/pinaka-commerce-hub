import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { PlansEntitlementsService } from './plans-entitlements.service';
import { DashboardAuthGuard } from '../dashboard-auth.guard';

@Controller([
  'api/v1/dashboard/plans-entitlements',
  'connectors/api/v1/dashboard/plans-entitlements',
  'api/v1/admin/dashboard/plans-entitlements',
])
@UseGuards(DashboardAuthGuard)
export class PlansEntitlementsController {
  constructor(@Inject(PlansEntitlementsService) private readonly service: PlansEntitlementsService) {}

  @Get()
  getSummary() {
    return this.service.getSummary();
  }
}
