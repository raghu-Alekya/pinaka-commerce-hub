import { Module } from '@nestjs/common';
import {
  RoleTemplateController as LegacyRoleTemplateController,
} from '../../master/common/master-data.controller';
import { MerchantRoleTemplateController } from './merchant-role-template.controller';
import {
  RoleTemplateFeatureAccessController,
  RoleTemplateStoreTypeBulkController,
  RoleTemplateStoreTypeCatalogController,
} from './role-template-mapping.controller';
import { RoleController } from './role.controller';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    RoleController,
    LegacyRoleTemplateController,
    MerchantRoleTemplateController,
    RoleTemplateStoreTypeCatalogController,
    RoleTemplateStoreTypeBulkController,
    RoleTemplateFeatureAccessController,
  ],
})
export class RoleTemplatesModule {}
