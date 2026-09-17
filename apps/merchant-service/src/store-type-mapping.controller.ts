import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { filterMasterList, groupFeaturesByCategory } from './master-list';
import { MerchantRepository } from './merchant.repository';
import { RELATIONSHIPS } from './relationships.config';
import { RelationshipOwnerGuard } from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';

const storeTypeFeatures = RELATIONSHIPS.find(config => config.name === 'StoreTypeFeatures')!;
const storeTypeRoleTemplates = RELATIONSHIPS.find(config => config.name === 'StoreTypeRoleTemplates')!;

@Controller(['api/v1/store-types/:storeTypeId/features', 'api/v1/store_types/:storeTypeId/features'])
@UseGuards(RelationshipOwnerGuard)
export class StoreTypeFeatureCatalogController {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository,
  ) {}

  @Get('by-category')
  async byCategory(@Param('storeTypeId') storeTypeId: string, @Query() query: Record<string, string>) {
    const mapped = await this.relationships.execute(storeTypeFeatures, 'list', { storeTypeId });
    const mappedIds = new Set((mapped.items as { featureId: string }[]).map(item => item.featureId.toLowerCase()));
    const features = filterMasterList(await this.merchants.masterData('features', 'list'), query)
      .map((feature: { id: string }) => ({ ...feature, mapped: mappedIds.has(String(feature.id).toLowerCase()) }));
    const unmappedOnly = query.unmappedOnly?.trim().toLowerCase() === 'true';
    const visible = unmappedOnly ? features.filter(feature => !feature.mapped) : features;
    const categories = groupFeaturesByCategory(visible).map(group => ({
      ...group,
      mappedCount: group.features.filter(feature => feature.mapped).length,
    }));
    return { success: true, count: categories.length, total: visible.length, categories };
  }
}

@Controller(['api/v1/store-types/:storeTypeId/role-templates', 'api/v1/store_types/:storeTypeId/role-templates'])
@UseGuards(RelationshipOwnerGuard)
export class StoreTypeRoleTemplateCatalogController {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository,
  ) {}

  @Get('available')
  async available(@Param('storeTypeId') storeTypeId: string, @Query() query: Record<string, string>) {
    const mapped = await this.relationships.execute(storeTypeRoleTemplates, 'list', { storeTypeId });
    const mappedIds = new Set((mapped.items as { roleTemplateId: string }[]).map(item => item.roleTemplateId.toLowerCase()));
    const roleTemplates = filterMasterList(await this.merchants.masterData('role_templates', 'list'), query)
      .map((template: { id: string }) => ({ ...template, mapped: mappedIds.has(String(template.id).toLowerCase()) }));
    const unmappedOnly = query.unmappedOnly?.trim().toLowerCase() === 'true';
    const visible = unmappedOnly ? roleTemplates.filter(template => !template.mapped) : roleTemplates;
    return { success: true, count: visible.length, roleTemplates: visible };
  }
}
