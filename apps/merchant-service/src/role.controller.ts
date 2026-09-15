import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject, Patch, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/merchants/:merchantId/roles')
export class RoleController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query('status') status?: string) {
    const roles = await this.repository.listRoles(merchantId, status);
    return { success: true, count: roles.length, roles };
  }

  @Get(':idOrCode')
  async get(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const role = await this.repository.getRoleByIdOrCode(merchantId, idOrCode);
    if (!role) throw new NotFoundException(`Role '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, role };
  }

  @Post()
  async create(@Param('merchantId') merchantId: string, @Body(new WorkforceValidationPipe({ expectedType: CreateRoleDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateRoleDto) {
    body.merchantId = merchantId;
    const existing = await this.repository.getRoleByIdOrCode(merchantId, body.roleCode);
    if (existing) throw new ConflictException(`Role code '${body.roleCode}' already exists for this merchant`);
    const role = await this.repository.createRole(body);
    return { success: true, message: 'Merchant custom role created successfully', role };
  }

  @Put(':idOrCode')
  async update(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string, @Body(new WorkforceValidationPipe({ expectedType: UpdateRoleDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateRoleDto) {
    const updated = await this.repository.updateRole(merchantId, idOrCode, body);
    if (!updated) throw new NotFoundException(`Role '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Role updated successfully', role: updated };
  }

  @Patch(':idOrCode')
  patch(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string, @Body(new WorkforceValidationPipe({ expectedType: UpdateRoleDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateRoleDto) { return this.update(merchantId, idOrCode, body); }

  @Delete(':idOrCode')
  async delete(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteRole(merchantId, idOrCode);
    if (!deleted) throw new NotFoundException(`Role '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Role deactivated successfully' };
  }
}
