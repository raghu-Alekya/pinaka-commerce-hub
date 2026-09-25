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
  UseGuards,
} from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { RELATIONSHIPS } from './relationships.config';
import { RelationshipOwnerGuard } from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';
import { SaveStoreRoleTemplatesDto } from './store-role-template.dto';
import { WorkforceValidationPipe } from './workforce-validation.pipe';

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
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(RelationshipsRepository) private readonly relationships: RelationshipsRepository,
  ) {}

  @Get('assigned')
  async assigned(
    @Param('storeTypeId') storeTypeId: string,
    @Query('status') status?: string,
    @Query('defaultEnabled') defaultEnabled?: string,
  ) {
    const roleTemplates = await this.merchants.listRoleTemplatesForStoreType(storeTypeId, {
      status,
      defaultEnabled:
        defaultEnabled === undefined
          ? undefined
          : defaultEnabled.trim().toLowerCase() === 'true',
    });
    return { success: true, count: roleTemplates.length, roleTemplates };
  }

  @Post('bulk')
  createBulk(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.relationships.createBulk(storeTypeRoleTemplates, params, body);
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
  create(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.relationships.execute(storeTypeRoleTemplates, 'create', params, undefined, body);
  }

  @Put(':relatedId')
  replace(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.relationships.execute(storeTypeRoleTemplates, 'replace', params, params.relatedId, body);
  }

  @Patch(':relatedId')
  patch(@Param() params: Record<string, string>, @Body() body: unknown) {
    return this.relationships.execute(storeTypeRoleTemplates, 'patch', params, params.relatedId, body);
  }

  @Delete(':relatedId')
  remove(@Param() params: Record<string, string>) {
    return this.relationships.execute(storeTypeRoleTemplates, 'delete', params, params.relatedId);
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
