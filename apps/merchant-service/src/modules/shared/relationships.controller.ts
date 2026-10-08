import { Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RELATIONSHIPS, EMPLOYEE_ACCESS_RELATIONSHIPS, Relationship } from './relationships.config';
import { RelationshipsRepository } from './relationships.repository';
import { filterMasterList } from '../master/common/master-list';
import { StoreTypeRepository } from '../master/store-setup/store-type.repository';

export type RelationshipRequest = { user?: { id?: string } };
export function relationshipUserId(request: RelationshipRequest): string {
  const userId = request.user?.id;
  if (!userId) throw new UnauthorizedException('Authenticated user id is required');
  return userId;
}

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
    constructor(
      @Inject(RelationshipsRepository) public readonly repository: RelationshipsRepository,
      @Inject(StoreTypeRepository) private readonly storeTypes: StoreTypeRepository,
    ) {}
    @Get()
    list(@Param() params: Record<string,string>) { return this.repository.execute(config, 'list', params); }
    @Get(':relatedId')
    async get(@Param() params: Record<string,string>, @Query() query: Record<string, string>) {
      // Keep this reserved catalog path working even if Nest registers the
      // parameter route before RoleTemplateStoreTypeCatalogController.
      if (config.name === 'RoleTemplateStoreTypes' && params.relatedId === 'available') {
        const mapped = await this.repository.execute(config, 'list', params);
        const mappings = new Map((mapped.items as { storeTypeId: string; id: string; defaultEnabled?: boolean; required?: boolean }[])
          .map(item => [item.storeTypeId.toLowerCase(), item]));
        const masterStoreTypes = filterMasterList(await this.storeTypes.list(), query) as Record<string, any>[];
        const all = masterStoreTypes.map(storeType => {
          const mapping = mappings.get(String(storeType.id).toLowerCase());
          return { ...storeType, mapped: Boolean(mapping), checked: Boolean(mapping), mappingId: mapping?.id || null,
            defaultEnabled: mapping?.defaultEnabled ?? false, required: mapping?.required ?? false };
        });
        const visible = query.unmappedOnly?.trim().toLowerCase() === 'true' ? all.filter(item => !item.mapped) : all;
        return { success: true, count: visible.length, storeTypes: visible };
      }
      return this.repository.execute(config, 'get', params, params.relatedId);
    }
    @Post()
    create(@Param() params: Record<string,string>, @Body() body: unknown, @Req() request: RelationshipRequest) { return this.repository.execute(config, 'create', params, undefined, body, request.user?.id); }
    @Put(':relatedId')
    replace(@Param() params: Record<string,string>, @Body() body: unknown, @Req() request: RelationshipRequest) { return this.repository.execute(config, 'replace', params, params.relatedId, body, request.user?.id); }
    @Patch(':relatedId')
    patch(@Param() params: Record<string,string>, @Body() body: unknown, @Req() request: RelationshipRequest) { return this.repository.execute(config, 'patch', params, params.relatedId, body, request.user?.id); }
    @Delete(':relatedId')
    remove(@Param() params: Record<string,string>, @Req() request: RelationshipRequest) { return this.repository.execute(config, 'delete', params, params.relatedId, undefined, request.user?.id); }
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
    create(@Param() params: Record<string, string>, @Body() body: unknown, @Req() request: RelationshipRequest) {
      return this.repository.createBulk(config, params, body, request.user?.id);
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
