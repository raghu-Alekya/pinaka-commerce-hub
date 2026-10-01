import { Module } from '@nestjs/common';
import {
  RELATIONSHIP_CONTROLLERS,
  RelationshipOwnerGuard,
  RoleTemplatePermissionsReplaceController,
} from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';

@Module({
  controllers: [...RELATIONSHIP_CONTROLLERS, RoleTemplatePermissionsReplaceController],
  providers: [RelationshipsRepository, RelationshipOwnerGuard],
  exports: [RelationshipsRepository, RelationshipOwnerGuard],
})
export class RelationshipsModule {}
