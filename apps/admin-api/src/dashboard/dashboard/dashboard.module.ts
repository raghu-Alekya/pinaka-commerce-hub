import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AdministrationOverviewController } from './administration_overview/administration_overview.controller';
import { AdministrationOverviewService } from './administration_overview/administration_overview.service';
import { DashboardFeaturesController } from './features/dashboard_features.controller';
import { DashboardFeaturesService } from './features/dashboard_features.service';
import { PlansEntitlementsController } from './plans_entitlements/plans_entitlements.controller';
import { PlansEntitlementsService } from './plans_entitlements/plans_entitlements.service';
import { PlatformHealthController } from './platform_health/platform_health.controller';
import { PlatformHealthService } from './platform_health/platform_health.service';
import { RolesPermissionsController } from './roles_permissions/roles_permissions.controller';
import { RolesPermissionsService } from './roles_permissions/roles_permissions.service';

@Module({
  controllers: [
    DashboardController,
    PlatformHealthController,
    DashboardFeaturesController,
    PlansEntitlementsController,
    AdministrationOverviewController,
    RolesPermissionsController,
  ],
  providers: [
    DashboardService,
    PlatformHealthService,
    DashboardFeaturesService,
    PlansEntitlementsService,
    AdministrationOverviewService,
    RolesPermissionsService,
  ],
})
export class DashboardModule {}
