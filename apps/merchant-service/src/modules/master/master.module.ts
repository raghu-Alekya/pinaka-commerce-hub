import { Module } from '@nestjs/common';
import { FeatureModule } from './feature/feature.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PlansModule } from './plans/plans.module';
import { RoleTemplatesModule } from './role-templates/role-templates.module';
import { StoreSetupModule } from './store-setup/store-setup.module';
import { TendersModule } from './tenders/tenders.module';

@Module({
  imports: [
    StoreSetupModule,
    FeatureModule,
    PermissionsModule,
    RoleTemplatesModule,
    PlansModule,
    TendersModule,
  ],
  exports: [
    StoreSetupModule,
    FeatureModule,
    PermissionsModule,
    RoleTemplatesModule,
    PlansModule,
    TendersModule,
  ],
})
export class MasterModule {}
