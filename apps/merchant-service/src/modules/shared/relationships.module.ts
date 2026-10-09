import { Module } from '@nestjs/common';
import {
  RELATIONSHIP_CONTROLLERS,
  RelationshipOwnerGuard,
  RoleTemplatePermissionsReplaceController,
} from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';

@Module({
  imports: [MerchantModule],
  controllers: [
    // Register these static paths before generic `:relatedId` relationship routes.
    RoleTemplateStoreTypeCatalogController,
    RoleTemplateStoreTypeBulkController,
    RoleTemplatePermissionsReplaceController,
    ...RELATIONSHIP_CONTROLLERS,
  ],
  providers: [RelationshipsRepository, RelationshipOwnerGuard, StoreTypeRepository],
  exports: [RelationshipsRepository, RelationshipOwnerGuard],
})
export class RelationshipsModule {}
