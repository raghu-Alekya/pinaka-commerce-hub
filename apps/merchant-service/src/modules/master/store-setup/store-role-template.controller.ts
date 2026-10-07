import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { RELATIONSHIPS } from '../../shared/relationships.config';
import { RelationshipOwnerGuard, relationshipUserId } from '../../shared/relationships.controller';
import type { RelationshipRequest } from '../../shared/relationships.controller';
import { RelationshipsRepository } from '../../shared/relationships.repository';
import { SaveStoreRoleTemplatesDto } from './store-role-template.dto';
import { WorkforceValidationPipe } from '../../employee/workforce-validation.pipe';

const storeTypeRoleTemplates = RELATIONSHIPS.find(config => config.name === 'StoreTypeRoleTemplates')!;

/**
 * Owns api/v1/store-types/:storeTypeId/role-templates entirely so static
 * segments like "assigned" / "bulk" are never captured as :relatedId.
 */
@Controller([
  'api/v1/store-types/:storeTypeId/role-templates',
  'api/v1/store_types/:storeTypeId/role-templates',
  'connector/api/v1/store-types/:storeTypeId/role-templates',
  'connector/api/v1/store_types/:storeTypeId/role-templates',
])
@UseGuards(RelationshipOwnerGuard)
export class StoreTypeAssignedRoleTemplatesController {
  constructor(
    @Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository,
  ) {}

  @Get('assigned')
  async assigned(
    @Param('storeTypeId') storeTypeId: string,
    @Query('status') status?: string,
  ) {
    const result = await this.relationships.execute(storeTypeRoleTemplates, 'list', { storeTypeId });
    const expectedStatus = status?.trim().toUpperCase();
    const roleTemplates = (result.items as Record<string, any>[]).filter(item =>
      !expectedStatus || item.templateStatus === expectedStatus,
    );
    return { success: true, count: roleTemplates.length, roleTemplates };
  }

  @Post('bulk')
  createBulk(@Param() params: Record<string, string>, @Body() body: unknown, @Req() request: RelationshipRequest) {
    return this.relationships.createBulk(storeTypeRoleTemplates, params, body, relationshipUserId(request));
  }

  @Get()
  list(@Param() params: Record<string, string>) {
    return this.relationships.execute(storeTypeRoleTemplates, 'list', params);
  }

  @Get(':relatedId')
  get(@Param() params: Record<string, string>) {
    return this.relationships.execute(storeTypeRoleTemplates, 'get', params, params.relatedId);
  }

  @Post()
  create(@Param() params: Record<string, string>, @Body() body: unknown, @Req() request: RelationshipRequest) {
    return this.relationships.execute(storeTypeRoleTemplates, 'create', params, undefined, body, relationshipUserId(request));
  }

  @Put(':relatedId')
  replace(@Param() params: Record<string, string>, @Body() body: unknown, @Req() request: RelationshipRequest) {
    return this.relationships.execute(storeTypeRoleTemplates, 'replace', params, params.relatedId, body, relationshipUserId(request));
  }

  @Patch(':relatedId')
  patch(@Param() params: Record<string, string>, @Body() body: unknown, @Req() request: RelationshipRequest) {
    return this.relationships.execute(storeTypeRoleTemplates, 'patch', params, params.relatedId, body, relationshipUserId(request));
  }

  @Delete(':relatedId')
  remove(@Param() params: Record<string, string>, @Req() request: RelationshipRequest) {
    return this.relationships.execute(storeTypeRoleTemplates, 'delete', params, params.relatedId, undefined, relationshipUserId(request));
  }
}

/** Tenant layer: which role templates are enabled for a merchant store. */
@Controller(['api/v1/merchants/:merchantId/stores/:storeId/role-templates', 'connector/api/v1/merchants/:merchantId/stores/:storeId/role-templates'])
@UseGuards(RelationshipOwnerGuard)
export class StoreRoleTemplateController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Param('storeId') storeId: string) {
    const roleTemplates = await this.repository.listStoreRoleTemplates(merchantId, storeId);
    return { success: true, count: roleTemplates.length, roleTemplates };
  }

  @Put()
  async save(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Body(
      new WorkforceValidationPipe({
        expectedType: SaveStoreRoleTemplatesDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: SaveStoreRoleTemplatesDto,
  ) {
    const roleTemplates = await this.repository.saveStoreRoleTemplates(merchantId, storeId, body);
    return {
      success: true,
      message: 'Store role templates saved',
      count: roleTemplates.length,
      roleTemplates,
    };
  }
}
