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
import { StoreTypeRepository } from './store-type.repository';

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
  providers: [StoreTypeRepository],
  exports: [StoreTypeRepository],
})
export class StoreSetupModule {}
