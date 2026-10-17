import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { PlansEntitlementsController } from './plans-entitlements/plans-entitlements.controller';
import { PlansEntitlementsService } from './plans-entitlements/plans-entitlements.service';
import { RolesPermissionsController } from './roles-permissions/roles-permissions.controller';
import { RolesPermissionsService } from './roles-permissions/roles-permissions.service';
import { DashboardDatabase } from './dashboard.database';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { PlatformHealthController } from './dashboard/platform_health/platform_health.controller';
import { PlatformHealthService } from './dashboard/platform_health/platform_health.service';
import { DashboardFeaturesController } from './dashboard/features/dashboard_features.controller';
import { DashboardFeaturesService } from './dashboard/features/dashboard_features.service';

@Module({
  controllers: [
    DashboardController,
    PlansEntitlementsController,
    RolesPermissionsController,
    PlatformHealthController,
    DashboardFeaturesController,
  ],
  providers: [
    DashboardDatabase,
    DashboardAuthGuard,
    PlansEntitlementsService,
    RolesPermissionsService,
    PlatformHealthService,
    DashboardFeaturesService,
  ],
})
export class DashboardModule {}
