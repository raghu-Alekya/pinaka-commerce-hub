import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, Inject, Patch, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreateMerchantRoleTemplateDto, UpdateMerchantRoleTemplateDto } from './merchant-role-template.dto';

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/merchants/:merchantId/role-templates')
export class MerchantRoleTemplateController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query('status') status?: string) {
    const roleTemplates = await this.repository.listMerchantRoleTemplates(merchantId, status);
    return { success: true, count: roleTemplates.length, roleTemplates };
  }

  @Get(':idOrCode')
  async get(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const roleTemplate = await this.repository.getMerchantRoleTemplate(merchantId, idOrCode);
    if (!roleTemplate) throw new NotFoundException(`Merchant role template '${idOrCode}' not found`);
    return { success: true, roleTemplate };
  }

  @Post()
  async create(
    @Param('merchantId') merchantId: string,
    @Body(new WorkforceValidationPipe({ expectedType: CreateMerchantRoleTemplateDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateMerchantRoleTemplateDto,
  ) {
    const roleTemplate = await this.repository.createMerchantRoleTemplate(merchantId, body);
    return { success: true, message: 'Merchant role template created successfully', roleTemplate };
  }

  @Put(':idOrCode')
  async update(
    @Param('merchantId') merchantId: string,
    @Param('idOrCode') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateMerchantRoleTemplateDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateMerchantRoleTemplateDto,
  ) {
    const roleTemplate = await this.repository.updateMerchantRoleTemplate(merchantId, idOrCode, body);
    if (!roleTemplate) throw new NotFoundException(`Merchant role template '${idOrCode}' not found`);
    return { success: true, message: 'Merchant role template updated successfully', roleTemplate };
  }

  @Patch(':idOrCode')
  patch(
    @Param('merchantId') merchantId: string,
    @Param('idOrCode') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateMerchantRoleTemplateDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateMerchantRoleTemplateDto,
  ) {
    return this.update(merchantId, idOrCode, body);
  }

  @Delete(':idOrCode')
  async delete(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteMerchantRoleTemplate(merchantId, idOrCode);
    if (!deleted) throw new NotFoundException(`Merchant role template '${idOrCode}' not found`);
    return { success: true, message: 'Merchant role template deactivated successfully' };
  }
}
