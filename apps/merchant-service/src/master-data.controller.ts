import { IsIn } from 'class-validator';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { filterMasterList } from './master-list';
import { MerchantRepository } from './merchant.repository';
import { FeatureDto, StoreTypeDto, RoleTemplateDto, PlanDto } from './master-data.dto';
import { MasterFormValidationPipe } from './master-form.pipe';

const defined = (body: object) => Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

const validate = (expectedType: typeof StoreTypeDto | typeof FeatureDto | typeof RoleTemplateDto | typeof PlanDto, patch = false) =>
  new MasterFormValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, skipUndefinedProperties: patch });
class StatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
const statusValidation = new MasterFormValidationPipe({
  expectedType: StatusDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller('api/v1/features')
export class FeatureController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get('categories')
  async categories() {
    const features = await this.repository.masterData('features', 'list');
    const categories = [...new Set<string>(features
      .map((feature: { category?: string | null }) => feature.category?.trim())
      .filter((category: string | undefined): category is string => Boolean(category)))]
      .sort((left, right) => left.localeCompare(right));
    return { success: true, count: categories.length, categories };
  }
  @Get() async list(@Query() query: Record<string, string>) { const features = filterMasterList(await this.repository.masterData('features', 'list'), query); return { success: true, count: features.length, features }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, feature: await this.repository.masterData('features', 'get', id) }; }
  @Post() async create(@Body(validate(FeatureDto)) body: FeatureDto) { return { success: true, feature: await this.repository.masterData('features', 'create', undefined, { description: '', status: 'ACTIVE', featureType: 'TEXT', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(FeatureDto)) body: FeatureDto) { return { success: true, feature: await this.repository.masterData('features', 'update', id, { description: '', status: 'ACTIVE', featureType: 'TEXT', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(FeatureDto, true)) body: FeatureDto) { return { success: true, feature: await this.repository.masterData('features', 'update', id, { ...defined(body) }) }; }
   @Put(':id/status')
  async replaceStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(statusValidation) body: StatusDto,
  ) { return this.updateStatus(id, body); }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(statusValidation) body: StatusDto,
  ) {
    const feature = await this.repository.masterData(
      'features',
      'update',
      id,
      {
        status: body.status,
      },
    );

    return {
      success: true,
      message: `Feature status updated to ${body.status}`,
      feature,
    };
  }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('features', 'delete', id); return { success: true, message: 'Feature deleted' }; }
}



@Controller(['api/v1/role-templates', 'api/v1/role_templates'])
export class RoleTemplateController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get() async list(@Query() query: Record<string, string>) { const items = filterMasterList(await this.repository.masterData('role_templates', 'list'), query); return { success: true, count: items.length, roleTemplates: items }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'get', id) }; }
  @Post() async create(@Body(validate(RoleTemplateDto)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'create', undefined, { description: '', status: 'ACTIVE', scopeType: 'STORE', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(RoleTemplateDto)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'update', id, { description: '', status: 'ACTIVE', scopeType: 'STORE', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(RoleTemplateDto, true)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'update', id, defined(body)) }; }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('role_templates', 'delete', id); return { success: true, message: 'RoleTemplate deleted' }; }
}
@Controller('api/v1/plans')
export class PlanController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get() async list(@Query() query: Record<string, string>) { const items = filterMasterList(await this.repository.masterData('plans', 'list'), query); return { success: true, count: items.length, plans: items }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, plan: await this.repository.masterData('plans', 'get', id) }; }
  @Post() async create(@Body(validate(PlanDto)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'create', undefined, { description: '', status: 'ACTIVE', currency: 'INR', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanDto)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'update', id, { description: '', status: 'ACTIVE', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanDto, true)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'update', id, defined(body)) }; }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('plans', 'delete', id); return { success: true, message: 'Plan deleted' }; }
}
