import { Module } from '@nestjs/common';
import { RoleTemplateController } from './role-template.controller'; // NEW file
// import { RoleTemplateController as LegacyRoleTemplateController } from '../../master/common/master-data.controller';
import { MerchantRoleTemplateController } from './merchant-role-template.controller';
import {
  RoleTemplateFeatureAccessController,
  RoleTemplateStoreTypeBulkController,
  RoleTemplateStoreTypeCatalogController,
} from './role-template-mapping.controller';
import { RoleController } from './role.controller';
import { RoleTemplateRepository } from './role-template.repository'; // <-- ADD
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    RoleController,
    RoleTemplateController,
    MerchantRoleTemplateController,
    RoleTemplateStoreTypeCatalogController,
    RoleTemplateStoreTypeBulkController,
    RoleTemplateFeatureAccessController,
  ],
  providers: [RoleTemplateRepository], // <-- ADD
  exports: [RoleTemplateRepository], // <-- ADD
})
export class RoleTemplatesModule {}
