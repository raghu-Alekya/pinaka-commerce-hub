import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { CreateRoleTemplateDto, UpdateRoleTemplateDto } from './role-template.dto';

@Public()
@Controller('api/v1/role-templates')
export class RoleTemplateController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Query('scopeType') scopeType?: string, @Query('status') status?: string) {
    const roleTemplates = await this.repository.listRoleTemplates(scopeType, status);
    return { success: true, count: roleTemplates.length, roleTemplates };
  }

  @Get(':idOrCode')
  async get(@Param('idOrCode') idOrCode: string) {
    const template = await this.repository.getRoleTemplateByIdOrCode(idOrCode);
    if (!template) throw new NotFoundException(`Role template '${idOrCode}' not found`);
    return { success: true, roleTemplate: template };
  }

  @Post()
  async create(@Body() body: CreateRoleTemplateDto) {
    const existing = await this.repository.getRoleTemplateByIdOrCode(body.roleCode);
    if (existing) throw new ConflictException(`Role code '${body.roleCode}' already exists`);
    const template = await this.repository.createRoleTemplate(body);
    return { success: true, message: 'Role template created successfully', roleTemplate: template };
  }

  @Put(':idOrCode')
  async update(@Param('idOrCode') idOrCode: string, @Body() body: UpdateRoleTemplateDto) {
    const updated = await this.repository.updateRoleTemplate(idOrCode, body);
    if (!updated) throw new NotFoundException(`Role template '${idOrCode}' not found`);
    return { success: true, message: 'Role template updated successfully', roleTemplate: updated };
  }

  @Delete(':idOrCode')
  async delete(@Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteRoleTemplate(idOrCode);
    if (!deleted) throw new NotFoundException(`Role template '${idOrCode}' not found`);
    return { success: true, message: 'Role template deactivated successfully' };
  }
}
