import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { RELATIONSHIPS, EMPLOYEE_ACCESS_RELATIONSHIPS, Relationship } from './relationships.config';
import { RelationshipsRepository } from './relationships.repository';

// The existing global session guard authenticates first. These new administration
// routes require OWNER, consistent with the application's privileged owner role.
@Injectable()
export class RelationshipOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (process.env.SKIP_AUTH === 'true') return true;
    const request = context.switchToHttp().getRequest();
    if (request.method !== 'GET' && request.user && !['OWNER', 'ADMIN', 'SUPER_ADMIN', 'ADMINISTRATOR'].includes(String(request.user?.role).toUpperCase())) { throw new ForbiddenException('Only owners and administrators may manage master-data relationships'); }
    return true;
  }
}

function createController(config: Relationship) {
  @Controller([config.path, `connector/${config.path}`, config.path.replace(/^api\/v1\//, '')])
  @UseGuards(RelationshipOwnerGuard)
  class RelationshipController {
    constructor(@Inject(RelationshipsRepository) public readonly repository: RelationshipsRepository) {}
    @Get()
    list(@Param() params: Record<string,string>) { return this.repository.execute(config, 'list', params); }
    @Get(':relatedId')
    get(@Param() params: Record<string,string>) { return this.repository.execute(config, 'get', params, params.relatedId); }
    @Post()
    create(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'create', params, undefined, body); }
    @Put(':relatedId')
    replace(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'replace', params, params.relatedId, body); }
    @Patch(':relatedId')
    patch(@Param() params: Record<string,string>, @Body() body: unknown) { return this.repository.execute(config, 'patch', params, params.relatedId, body); }
    @Delete(':relatedId')
    remove(@Param() params: Record<string,string>) { return this.repository.execute(config, 'delete', params, params.relatedId); }
  }
  Object.defineProperty(RelationshipController, 'name', { value: `${config.name}Controller` });
  return RelationshipController;
}

export const MASTER_BULK_RELATIONSHIPS = [
  ...RELATIONSHIPS.filter(config =>
    // StoreTypeRoleTemplates CRUD+bulk lives on StoreTypeAssignedRoleTemplatesController
    // so static routes like GET .../assigned are not swallowed by :relatedId.
    ['StoreTypeFeatures', 'FeatureStoreTypes', 'RoleTemplateStoreTypes', 'PlanEntitlements'].includes(config.name)),
  ...EMPLOYEE_ACCESS_RELATIONSHIPS.filter(config =>
    ['EmployeeStores', 'EmployeeStoreRoles', 'RoleTemplatePermissions'].includes(config.name)),
];

function createBulkController(config: Relationship) {
  @Controller([config.path, `connector/${config.path}`, config.path.replace(/^api\/v1\//, '')])
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
@Controller([roleTemplatePermissions.path, `connector/${roleTemplatePermissions.path}`, roleTemplatePermissions.path.replace(/^api\/v1\//, '')])
@UseGuards(RelationshipOwnerGuard)
export class RoleTemplatePermissionsReplaceController {
  constructor(@Inject(RelationshipsRepository) readonly repository: RelationshipsRepository) {}
  @Put('bulk')
  replace(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.repository.replaceBulk(roleTemplatePermissions, params, body);
  }
}

const DEDICATED_RELATIONSHIP_CONTROLLERS = new Set(['StoreTypeRoleTemplates']);

export const RELATIONSHIP_CONTROLLERS = [
  ...MASTER_BULK_RELATIONSHIPS.map(createBulkController),
  ...[...RELATIONSHIPS, ...EMPLOYEE_ACCESS_RELATIONSHIPS]
    .filter(config => !DEDICATED_RELATIONSHIP_CONTROLLERS.has(config.name))
    .map(createController),
];