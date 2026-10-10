import { Module } from '@nestjs/common';
import { FeaturePermissionController } from './feature-permission.controller';
import { PermissionController } from './permission.controller';
import { RolePermissionController } from './role-permission.controller';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    PermissionController,
    FeaturePermissionController,
    RolePermissionController,
  ],
})
export class PermissionsModule {}
