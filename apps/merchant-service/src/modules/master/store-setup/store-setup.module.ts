import { Module } from '@nestjs/common';
import {
  FeatureStoreTypeCatalogController,
  StoreTypeFeatureCatalogController,
  StoreTypeRoleTemplateCatalogController,
} from './store-type-mapping.controller';
import {
  StoreRoleTemplateController,
  StoreTypeAssignedRoleTemplatesController,
} from './store-role-template.controller';
import { StoreTypeController } from './store-type.controller';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    StoreTypeController,
    StoreTypeFeatureCatalogController,
    FeatureStoreTypeCatalogController,
    StoreTypeRoleTemplateCatalogController,
    StoreTypeAssignedRoleTemplatesController,
    StoreRoleTemplateController,
  ],
})
export class StoreSetupModule {}
