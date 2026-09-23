import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { Controller, Get, Post, Put, Delete, Param, Body, NotFoundException, Inject, Patch, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { BulkStoreRolePermissionsDto, CreateStoreRolePermissionDto, UpdateStoreRolePermissionDto } from './role-permission.dto';

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/merchants/:merchantId/stores/:storeId/roles/:roleId/permissions')
export class RolePermissionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
  ) {
    const items = await this.repository.listStoreRolePermissions(merchantId, storeId, roleId);
    return { success: true, count: items.length, items };
  }

  @Get(':permissionId')
  async get(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ) {
    const item = await this.repository.getStoreRolePermission(merchantId, storeId, roleId, permissionId);
    if (!item) throw new NotFoundException('Role permission not found for this store');
    return { success: true, item };
  }

  @Post()
  async create(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Body(new WorkforceValidationPipe({ expectedType: CreateStoreRolePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateStoreRolePermissionDto,
  ) {
    const item = await this.repository.upsertStoreRolePermission(merchantId, storeId, roleId, body.permissionId, body.allowed !== false);
    return { success: true, message: 'Store role permission saved', item };
  }

  @Post('bulk')
  async createBulk(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Body(new WorkforceValidationPipe({ expectedType: BulkStoreRolePermissionsDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: BulkStoreRolePermissionsDto,
  ) {
    const items = await this.repository.upsertStoreRolePermissionsBulk(merchantId, storeId, roleId, body.items);
    return { success: true, count: items.length, items };
  }

  @Put(':permissionId')
  async replace(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateStoreRolePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateStoreRolePermissionDto,
  ) {
    const item = await this.repository.upsertStoreRolePermission(merchantId, storeId, roleId, permissionId, body.allowed);
    return { success: true, message: 'Store role permission saved', item };
  }

  @Patch(':permissionId')
  patch(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateStoreRolePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateStoreRolePermissionDto,
  ) {
    return this.replace(merchantId, storeId, roleId, permissionId, body);
  }

  @Delete(':permissionId')
  async remove(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ) {
    const deleted = await this.repository.deleteStoreRolePermission(merchantId, storeId, roleId, permissionId);
    if (!deleted) throw new NotFoundException('Role permission not found for this store');
    return { success: true, message: 'Store role permission removed' };
  }
}
