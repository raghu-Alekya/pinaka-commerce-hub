import { Module } from '@nestjs/common';
import {
  RELATIONSHIP_CONTROLLERS,
  RelationshipOwnerGuard,
  RoleTemplatePermissionsReplaceController,
} from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';

@Module({
  controllers: [
    RoleTemplatePermissionsReplaceController,
    ...RELATIONSHIP_CONTROLLERS,
  ],
  providers: [RelationshipsRepository, RelationshipOwnerGuard],
  exports: [RelationshipsRepository, RelationshipOwnerGuard],
})
export class RelationshipsModule {}
