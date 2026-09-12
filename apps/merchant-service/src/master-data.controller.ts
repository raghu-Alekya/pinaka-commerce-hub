import { IsIn } from 'class-validator';
import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, ValidationPipe } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { FeatureDto, StoreTypeDto, RoleTemplateDto, PlanDto } from './master-data.dto';

const defined = (body: object) => Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

const validate = (expectedType: typeof StoreTypeDto | typeof FeatureDto | typeof RoleTemplateDto | typeof PlanDto, patch = false) =>
  new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, skipUndefinedProperties: patch });
class StatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
const statusValidation = new ValidationPipe({
  expectedType: StatusDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
@Controller(['api/v1/store-types', 'api/v1/store_types'])
export class StoreTypeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get() async list() { const storeTypes = await this.repository.masterData('store_types', 'list'); return { success: true, count: storeTypes.length, storeTypes }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, storeType: await this.repository.masterData('store_types', 'get', id) }; }
  @Post() async create(@Body(validate(StoreTypeDto)) body: StoreTypeDto) { return { success: true, storeType: await this.repository.masterData('store_types', 'create', undefined, { description: '', status: 'ACTIVE', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(StoreTypeDto)) body: StoreTypeDto) { return { success: true, storeType: await this.repository.masterData('store_types', 'update', id, { description: '', status: 'ACTIVE', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(StoreTypeDto, true)) body: StoreTypeDto) { return { success: true, storeType: await this.repository.masterData('store_types', 'update', id, { ...defined(body) }) }; }
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
    const storeType = await this.repository.masterData(
      'store_types',
      'update',
      id,
      {
        status: body.status,
      },
    );

    return {
      success: true,
      message: `Store type status updated to ${body.status}`,
      storeType,
    };
  }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('store_types', 'delete', id); return { success: true, message: 'Store type deleted' }; }
}

@Controller('api/v1/features')
export class FeatureController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get() async list() { const features = await this.repository.masterData('features', 'list'); return { success: true, count: features.length, features }; }
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
  @Get() async list() { const items = await this.repository.masterData('role_templates', 'list'); return { success: true, count: items.length, roleTemplates: items }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'get', id) }; }
  @Post() async create(@Body(validate(RoleTemplateDto)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'create', undefined, { description: '', status: 'ACTIVE', scopeType: 'STORE', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(RoleTemplateDto)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'update', id, { description: '', status: 'ACTIVE', scopeType: 'STORE', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(RoleTemplateDto, true)) body: RoleTemplateDto) { return { success: true, roleTemplate: await this.repository.masterData('role_templates', 'update', id, defined(body)) }; }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('role_templates', 'delete', id); return { success: true, message: 'RoleTemplate deleted' }; }
}
@Controller('api/v1/plans')
export class PlanController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  @Get() async list() { const items = await this.repository.masterData('plans', 'list'); return { success: true, count: items.length, plans: items }; }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, plan: await this.repository.masterData('plans', 'get', id) }; }
  @Post() async create(@Body(validate(PlanDto)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'create', undefined, { description: '', status: 'ACTIVE', ...defined(body) }) }; }
  @Put(':id') async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanDto)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'update', id, { description: '', status: 'ACTIVE', ...defined(body) }) }; }
  @Patch(':id') async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanDto, true)) body: PlanDto) { return { success: true, plan: await this.repository.masterData('plans', 'update', id, defined(body)) }; }
  @Delete(':id') async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.repository.masterData('plans', 'delete', id); return { success: true, message: 'Plan deleted' }; }
}
