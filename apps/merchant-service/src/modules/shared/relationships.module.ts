import { Module } from '@nestjs/common';
import {
  RELATIONSHIP_CONTROLLERS,
  RelationshipOwnerGuard,
  RoleTemplatePermissionsReplaceController,
} from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';
import { MerchantModule } from '../merchant/merchant.module';
import { StoreTypeRepository } from '../master/store-setup/store-type.repository';
import {
  RoleTemplateStoreTypeBulkController,
  RoleTemplateStoreTypeCatalogController,
} from '../master/role-templates/role-template-mapping.controller';

@Module({
  imports: [MerchantModule],
  controllers: [
    // Register these static paths before generic `:relatedId` relationship routes.
    RoleTemplateStoreTypeCatalogController,
    RoleTemplateStoreTypeBulkController,
    ...RELATIONSHIP_CONTROLLERS,
    RoleTemplatePermissionsReplaceController,
  ],
  providers: [RelationshipsRepository, RelationshipOwnerGuard, StoreTypeRepository],
  exports: [RelationshipsRepository, RelationshipOwnerGuard],
})
export class RelationshipsModule {}
