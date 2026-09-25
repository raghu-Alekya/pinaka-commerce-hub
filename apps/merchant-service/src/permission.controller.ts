import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject, Patch, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreatePermissionDto, UpdatePermissionDto } from './permission.dto';

@UseGuards(RelationshipOwnerGuard)
@Controller(['api/v1/permissions', 'connector/api/v1/permissions', 'permissions'])
export class PermissionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Query('featureId') featureId?: string, @Query('status') status?: string) {
    const permissions = await this.repository.listPermissions(featureId, status);
    return { success: true, count: permissions.length, permissions };
  }

  @Get(':idOrKey')
  async get(@Param('idOrKey') idOrKey: string) {
    const permission = await this.repository.getPermissionByIdOrKey(idOrKey);
    if (!permission) throw new NotFoundException(`Permission '${idOrKey}' not found`);
    return { success: true, permission };
  }

  @Post()
  async create(@Body(new WorkforceValidationPipe({ expectedType: CreatePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreatePermissionDto) {
    const existing = await this.repository.getPermissionByIdOrKey(body.permissionKey);
    if (existing) throw new ConflictException(`Permission key '${body.permissionKey}' already exists`);
    const permission = await this.repository.createPermission(body);
    return { success: true, message: 'Permission created successfully', permission };
  }

  @Put(':idOrKey')
  async update(@Param('idOrKey') idOrKey: string, @Body(new WorkforceValidationPipe({ expectedType: UpdatePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdatePermissionDto) {
    const updated = await this.repository.updatePermission(idOrKey, body);
    if (!updated) throw new NotFoundException(`Permission '${idOrKey}' not found`);
    return { success: true, message: 'Permission updated successfully', permission: updated };
  }

  @Patch(':idOrKey')
  patch(@Param('idOrKey') idOrKey: string, @Body(new WorkforceValidationPipe({ expectedType: UpdatePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdatePermissionDto) { return this.update(idOrKey, body); }

  @Delete(':idOrKey')
  async delete(@Param('idOrKey') idOrKey: string) {
    const deleted = await this.repository.deletePermission(idOrKey);
    if (!deleted) throw new NotFoundException(`Permission '${idOrKey}' not found`);
    return { success: true, message: 'Permission deactivated successfully' };
  }
}
