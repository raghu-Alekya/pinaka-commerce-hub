import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { IsIn } from 'class-validator';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreateFeaturePermissionDto, UpdateFeaturePermissionDto } from './permission.dto';
import { PermissionStatus } from './entities/permission.entity';
import { MasterFormValidationPipe } from './master-form.pipe';

class PermissionStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: PermissionStatus;
}

const statusValidation = new MasterFormValidationPipe({
  expectedType: PermissionStatusDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

function matchesSearch(permission: { permissionKey?: string; name?: string; description?: string }, search?: string) {
  const query = search?.trim().toLowerCase();
  if (!query) return true;
  return [permission.permissionKey, permission.name, permission.description]
    .some(value => String(value ?? '').toLowerCase().includes(query));
}

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/features/:featureId/permissions')
export class FeaturePermissionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  private async feature(featureId: string) {
    return this.repository.masterData('features', 'get', featureId);
  }

  private async scoped(featureId: string, idOrKey: string) {
    await this.feature(featureId);
    const permission = await this.repository.getPermissionByIdOrKey(idOrKey);
    if (!permission || permission.featureId.toLowerCase() !== featureId.toLowerCase()) {
      throw new NotFoundException(`Permission '${idOrKey}' not found`);
    }
    return permission;
  }

  @Get()
  async list(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    await this.feature(featureId);
    const normalized = status?.trim().toUpperCase();
    const statusFilter = !normalized || ['ALL', 'ALL STATUSES', 'ALL PERMISSIONS'].includes(normalized)
      ? undefined
      : normalized;
    if (statusFilter && !['ACTIVE', 'INACTIVE'].includes(statusFilter)) {
      throw new BadRequestException('Invalid status');
    }
    const permissions = (await this.repository.listPermissions(featureId, statusFilter))
      .filter(permission => matchesSearch(permission, search));
    return { success: true, count: permissions.length, permissions };
  }

  @Get(':idOrKey')
  async get(@Param('featureId', new ParseUUIDPipe()) featureId: string, @Param('idOrKey') idOrKey: string) {
    return { success: true, permission: await this.scoped(featureId, idOrKey) };
  }

  @Post('bulk')
  createBulk(@Param('featureId', new ParseUUIDPipe()) featureId: string, @Body() body: unknown) {
    return this.repository.createFeaturePermissions(featureId, body);
  }

  @Patch('bulk')
  saveBulk(@Param('featureId', new ParseUUIDPipe()) featureId: string, @Body() body: unknown) {
    return this.repository.updateFeaturePermissions(featureId, body);
  }

  @Put('bulk')
  replaceBulk(@Param('featureId', new ParseUUIDPipe()) featureId: string, @Body() body: unknown) {
    return this.saveBulk(featureId, body);
  }

  @Post()
  async create(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Body(new WorkforceValidationPipe({ expectedType: CreateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateFeaturePermissionDto,
  ) {
    if (body.featureId && body.featureId.toLowerCase() !== featureId.toLowerCase()) {
      throw new BadRequestException('featureId must match the feature in the URL');
    }
    await this.feature(featureId);
    const existing = await this.repository.getPermissionByIdOrKey(body.permissionKey);
    if (existing) throw new ConflictException(`Permission key '${body.permissionKey.trim().toUpperCase()}' already exists`);
    const permission = await this.repository.createPermission({ ...body, featureId });
    return { success: true, message: 'Permission created successfully', permission };
  }

  @Put(':idOrKey')
  async update(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('idOrKey') idOrKey: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateFeaturePermissionDto,
  ) {
    await this.scoped(featureId, idOrKey);
    const permission = await this.repository.updatePermission(idOrKey, body);
    return { success: true, message: 'Permission updated successfully', permission };
  }

  @Patch(':idOrKey')
  patch(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('idOrKey') idOrKey: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateFeaturePermissionDto,
  ) {
    return this.update(featureId, idOrKey, body);
  }

  @Put(':idOrKey/status')
  replaceStatus(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('idOrKey') idOrKey: string,
    @Body(statusValidation) body: PermissionStatusDto,
  ) {
    return this.updateStatus(featureId, idOrKey, body);
  }

  @Patch(':idOrKey/status')
  async updateStatus(
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('idOrKey') idOrKey: string,
    @Body(statusValidation) body: PermissionStatusDto,
  ) {
    await this.scoped(featureId, idOrKey);
    const permission = await this.repository.updatePermission(idOrKey, { status: body.status });
    return { success: true, message: `Permission status updated to ${body.status}`, permission };
  }

  @Delete(':idOrKey')
  async delete(@Param('featureId', new ParseUUIDPipe()) featureId: string, @Param('idOrKey') idOrKey: string) {
    await this.scoped(featureId, idOrKey);
    await this.repository.deletePermission(idOrKey);
    return { success: true, message: 'Permission deactivated successfully' };
  }
}
