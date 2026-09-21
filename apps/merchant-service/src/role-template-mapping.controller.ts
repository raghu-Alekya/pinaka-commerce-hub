import { Body, Controller, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { filterMasterList } from './master-list';
import { MerchantRepository } from './merchant.repository';
import { RELATIONSHIPS } from './relationships.config';
import { RelationshipOwnerGuard } from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';

const roleTemplateStoreTypes = RELATIONSHIPS.find(config => config.name === 'RoleTemplateStoreTypes')!;

// Full unique paths — must not share @Controller path with generated RoleTemplateStoreTypes CRUD.
@Controller([
  'api/v1/role-templates/:roleTemplateId/store-types/available',
  'api/v1/role_templates/:roleTemplateId/store-types/available',
])
@UseGuards(RelationshipOwnerGuard)
export class RoleTemplateStoreTypeCatalogController {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository,
  ) {}

  @Get()
  async available(@Param('roleTemplateId') roleTemplateId: string, @Query() query: Record<string, string>) {
    const mapped = await this.relationships.execute(roleTemplateStoreTypes, 'list', { roleTemplateId });
    const mappings = new Map((mapped.items as { id: string; storeTypeId: string; defaultEnabled: boolean; required: boolean }[])
      .map(item => [item.storeTypeId.toLowerCase(), item]));
    const masterStoreTypes = (filterMasterList(await this.merchants.masterData('store_types', 'list'), query) || []) as Record<string, any>[];
    const storeTypes = masterStoreTypes.map((storeType: Record<string, any>) => {
      const mapping = mappings.get(String(storeType.id).toLowerCase());
      return {
        ...storeType,
        mapped: Boolean(mapping),
        checked: Boolean(mapping),
        mappingId: mapping?.id || null,
        defaultEnabled: mapping?.defaultEnabled ?? false,
        required: mapping?.required ?? false,
      };
    });
    const unmappedOnly = query.unmappedOnly?.trim().toLowerCase() === 'true';
    const visible = unmappedOnly ? storeTypes.filter(storeType => !storeType.mapped) : storeTypes;
    return { success: true, count: visible.length, storeTypes: visible };
  }
}

@Controller([
  'api/v1/role-templates/:roleTemplateId/store-types/bulk',
  'api/v1/role_templates/:roleTemplateId/store-types/bulk',
])
@UseGuards(RelationshipOwnerGuard)
export class RoleTemplateStoreTypeBulkController {
  constructor(@Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository) {}

  @Put()
  replace(@Param('roleTemplateId') roleTemplateId: string, @Body() body: unknown) {
    return this.relationships.saveRoleTemplateStoreTypes(roleTemplateStoreTypes, { roleTemplateId }, body);
  }

  @Post()
  create(@Param('roleTemplateId') roleTemplateId: string, @Body() body: unknown) {
    return this.relationships.saveRoleTemplateStoreTypes(roleTemplateStoreTypes, { roleTemplateId }, body);
  }
}

@Controller(['api/v1/role-templates/:roleTemplateId/features', 'api/v1/role_templates/:roleTemplateId/features'])
@UseGuards(RelationshipOwnerGuard)
export class RoleTemplateFeatureAccessController {
  constructor(@Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository) {}

  @Get()
  list(@Param('roleTemplateId') roleTemplateId: string, @Query() query: Record<string, string | string[]>) {
    return this.relationships.listRoleTemplateAccess(roleTemplateId, query);
  }
}
