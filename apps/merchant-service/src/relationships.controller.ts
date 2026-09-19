import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { RELATIONSHIPS, EMPLOYEE_ACCESS_RELATIONSHIPS, Relationship } from './relationships.config';
import { RelationshipsRepository } from './relationships.repository';

// The existing global session guard authenticates first. These new administration
// routes require OWNER, consistent with the application's privileged owner role.
@Injectable()
export class RelationshipOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== 'OWNER') throw new ForbiddenException('Only owners may manage master-data relationships');
    return true;
  }
}

// Catalog controllers own GET available / PUT bulk on some of these paths.
// Keep :relatedId as UUID-only so it cannot swallow the static "available" segment.
const RELATED_ID = ':relatedId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

function createController(config: Relationship) {
  @Controller(config.path)
  @UseGuards(RelationshipOwnerGuard)
  class RelationshipController {
    constructor(@Inject(RelationshipsRepository) public readonly repository: RelationshipsRepository) {}
    @Get()
    list(@Param() params: Record<string,string>) { return this.repository.execute(config, 'list', params); }
    @Get(RELATED_ID)
    get(@Param() params: Record<string,string>) { return this.repository.execute(config, 'get', params, params.relatedId); }
    @Post()
    create(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'create', params, undefined, body); }
    @Put(RELATED_ID)
    replace(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'replace', params, params.relatedId, body); }
    @Patch(RELATED_ID)
    patch(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'patch', params, params.relatedId, body); }
    @Delete(RELATED_ID)
    remove(@Param() params: Record<string,string>) { return this.repository.execute(config, 'delete', params, params.relatedId); }
  }
  Object.defineProperty(RelationshipController, 'name', { value: `${config.name}Controller` });
  return RelationshipController;
}

export const MASTER_BULK_RELATIONSHIPS = [
  ...RELATIONSHIPS.filter(config =>
    ['StoreTypeFeatures', 'FeatureStoreTypes', 'StoreTypeRoleTemplates', 'RoleTemplateStoreTypes', 'PlanEntitlements'].includes(config.name)),
  ...EMPLOYEE_ACCESS_RELATIONSHIPS.filter(config => config.name === 'RoleTemplatePermissions'),
];

function createBulkController(config: Relationship) {
  @Controller(config.path)
  @UseGuards(RelationshipOwnerGuard)
  class BulkRelationshipController {
    constructor(@Inject(RelationshipsRepository) readonly repository: RelationshipsRepository) {}
    @Post('bulk')
    create(@Param() params: Record<string, string>, @Body() body: unknown) {
      return this.repository.createBulk(config, params, body);
    }
  }
  Object.defineProperty(BulkRelationshipController, 'name', { value: `${config.name}BulkController` });
  return BulkRelationshipController;
}

const roleTemplatePermissions = EMPLOYEE_ACCESS_RELATIONSHIPS.find(config => config.name === 'RoleTemplatePermissions')!;
@Controller(roleTemplatePermissions.path)
@UseGuards(RelationshipOwnerGuard)
export class RoleTemplatePermissionsReplaceController {
  constructor(@Inject(RelationshipsRepository) readonly repository: RelationshipsRepository) {}
  @Put('bulk')
  replace(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.repository.replaceBulk(roleTemplatePermissions, params, body);
  }
}

export const RELATIONSHIP_CONTROLLERS = [
  ...MASTER_BULK_RELATIONSHIPS.map(createBulkController),
  ...[...RELATIONSHIPS, ...EMPLOYEE_ACCESS_RELATIONSHIPS].map(createController),
];
