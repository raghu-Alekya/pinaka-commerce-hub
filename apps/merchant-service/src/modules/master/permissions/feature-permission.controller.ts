import { WorkforceValidationPipe } from '../../employee/workforce-validation.pipe';
import { IsIn } from 'class-validator';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from '../../shared/relationships.controller';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { CreateFeaturePermissionDto, UpdateFeaturePermissionDto } from '../../../feature-permission.dto';
import { FeaturePermissionEntity } from '../../../entities/feature-permission.entity';
import { PermissionType, RecordStatus } from '../../../entities/commerce-enums';
import { MasterFormValidationPipe } from '../common/master-form.pipe';
import { parsePage, permissionRequestToInternal, toSnakeCaseResponse } from './permission-api-mapping';

class PermissionStatusDto {
  @IsIn([RecordStatus.ACTIVE, RecordStatus.INACTIVE])
  status!: RecordStatus;
}

const statusValidation = new MasterFormValidationPipe({
  expectedType: PermissionStatusDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

type AuthenticatedRequest = { user?: { id?: string } };
const auditUserId = (request: AuthenticatedRequest): string => {
  const id = request.user?.id;
  if (!id) throw new UnauthorizedException('Authenticated user UUID is unavailable');
  return id;
};

@UseGuards(RelationshipOwnerGuard)
@Controller(['api/v1/features/:feature_id/permissions', 'connector/api/v1/features/:feature_id/permissions', 'features/:feature_id/permissions'])
export class FeaturePermissionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  private async feature(featureId: string) {
    return this.repository.masterData('features', 'get', featureId);
  }

  private async scoped(featureId: string, idOrKey: string) {
    const permission = await this.repository.getFeaturePermissionByIdOrCode(idOrKey, featureId);
    if (!permission) {
      throw new NotFoundException(`Permission '${idOrKey}' not found`);
    }
    return permission;
  }

  private bulkItems(body: unknown): Record<string, unknown>[] {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Provide { items: [...] }');
    const payload = body as Record<string, unknown>;
    if (Object.keys(payload).some(key => key !== 'items' && key !== 'skip_existing')) {
      throw new BadRequestException('Provide { items: [...] }');
    }
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
      throw new BadRequestException('items must contain between 1 and 100 permissions');
    }
    if (payload.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new BadRequestException('Each item must be an object');
    }
    return payload.items as Record<string, unknown>[];
  }

  @Get()
  async list(
    @Param('feature_id') featureId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    await this.feature(featureId);
    const normalized = status?.trim().toUpperCase();
    const statusFilter = !normalized || ['ALL', 'ALL STATUSES', 'ALL PERMISSIONS'].includes(normalized)
      ? undefined
      : normalized;
    if (statusFilter && !['ACTIVE', 'INACTIVE'].includes(statusFilter)) {
      throw new BadRequestException('Invalid status');
    }
    const filteredSearch = search?.trim();
    const paginated = pageParam !== undefined || limitParam !== undefined;
    const page = parsePage(pageParam, 1, 'page');
    const limit = paginated ? parsePage(limitParam, 100, 'limit') : undefined;
    const { permissions, total } = await this.repository.listFeaturePermissions(featureId, {
      status: statusFilter,
      search: filteredSearch,
      page: paginated ? page : undefined,
      limit,
    });
    const responseLimit = limit ?? (total || 1);
    const totalPages = total ? Math.ceil(total / responseLimit) : 0;
    return {
      success: true,
      count: total,
      permissions: toSnakeCaseResponse(permissions),
      page,
      limit: responseLimit,
      total_pages: totalPages,
      next_page: page < totalPages ? page + 1 : null,
      previous_page: page > 1 && totalPages ? page - 1 : null,
    };
  }

  @Get(':id_or_code')
  async get(@Param('feature_id') featureId: string, @Param('id_or_code') idOrCode: string) {
    const permission = await this.repository.getFeaturePermissionByIdOrCode(idOrCode, featureId, true);
    if (!permission) throw new NotFoundException(`Permission '${idOrCode}' not found`);
    return { success: true, permission: toSnakeCaseResponse(permission) };
  }

  @Post('bulk')
  async createBulk(@Param('feature_id') featureId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const userId = auditUserId(request);
    const payload = this.bulkItems(body);
    const skipExisting = (body as { skip_existing?: unknown })?.skip_existing === true;
    const permissions: FeaturePermissionEntity[] = [];
    for (const item of payload) {
      const allowed = ['feature_id', 'permission_code', 'permission_type', 'name', 'description', 'status'];
      if (Object.keys(item).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown or immutable field');
      if ((item.permission_code !== undefined && typeof item.permission_code !== 'string') ||
          (typeof item.permission_type !== 'string' || !Object.values(PermissionType).includes(item.permission_type as PermissionType)) ||
          typeof item.name !== 'string' || !item.name.trim()) {
        throw new BadRequestException('Each item requires permission_type and name; permission_code is generated on save');
      }
      if (item.status !== undefined && !Object.values(RecordStatus).includes(item.status as RecordStatus)) {
        throw new BadRequestException('Invalid status');
      }
      const fields = permissionRequestToInternal(item);
      if (fields.featureId && String(fields.featureId).toLowerCase() !== featureId.toLowerCase()) {
        throw new BadRequestException('feature_id must match the feature in the URL');
      }
      try {
        permissions.push(await this.repository.createFeaturePermission({
          featureId,
          permissionType: item.permission_type as PermissionType,
          name: String(item.name).trim(),
          description: typeof item.description === 'string' ? item.description : undefined,
          status: item.status === RecordStatus.ACTIVE ? RecordStatus.ACTIVE : item.status === RecordStatus.INACTIVE ? RecordStatus.INACTIVE : undefined,
          createdBy: userId,
          updatedBy: userId,
        }));
      } catch (error) {
        if (!skipExisting || !(error instanceof ConflictException)) throw error;
      }
    }
    return { success: true, count: permissions.length, permissions: toSnakeCaseResponse(permissions) };
  }

  @Patch('bulk')
  async saveBulk(@Param('feature_id') featureId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const userId = auditUserId(request);
    const payload = this.bulkItems(body);
    const permissions: FeaturePermissionEntity[] = [];
    for (const item of payload) {
      const allowed = ['id', 'feature_id', 'permission_code', 'permission_type', 'name', 'description', 'status'];
      if (Object.keys(item).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown or immutable field');
      const fields = permissionRequestToInternal(item) as Record<string, unknown> & {
        id?: string; permissionCode?: string; permissionType?: PermissionType; name?: string; description?: string; status?: string;
      };
      const idOrCode = fields.id || fields.permissionCode;
      if (!idOrCode) throw new BadRequestException('Each item requires id or permission_code');
      delete fields.id;
      delete fields.permissionCode;
      if (!Object.keys(fields).length) throw new BadRequestException('Provide at least one field to update');
      if (fields.permissionType !== undefined && !Object.values(PermissionType).includes(fields.permissionType)) {
        throw new BadRequestException('Invalid permission_type');
      }
      if (fields.status !== undefined && !Object.values(RecordStatus).includes(fields.status as RecordStatus)) {
        throw new BadRequestException('Invalid status');
      }
      const updated = await this.repository.updateFeaturePermission(String(idOrCode), featureId, {
        permissionType: fields.permissionType,
        name: fields.name,
        description: fields.description,
        status: fields.status === RecordStatus.ACTIVE ? RecordStatus.ACTIVE : fields.status === RecordStatus.INACTIVE ? RecordStatus.INACTIVE : undefined,
        updatedBy: userId,
      });
      if (!updated) throw new NotFoundException(`Permission '${idOrCode}' not found`);
      permissions.push(updated);
    }
    return { success: true, count: permissions.length, permissions: toSnakeCaseResponse(permissions) };
  }

  @Put('bulk')
  replaceBulk(@Param('feature_id') featureId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.saveBulk(featureId, body, request);
  }

  @Post()
  async create(
    @Param('feature_id') featureId: string,
    @Body(new WorkforceValidationPipe({ expectedType: CreateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateFeaturePermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (body.featureId && body.featureId.toLowerCase() !== featureId.toLowerCase()) {
      throw new BadRequestException('feature_id must match the feature in the URL');
    }
    await this.feature(featureId);
    const userId = auditUserId(request);
    const permission = await this.repository.createFeaturePermission({
      featureId,
      permissionType: body.permissionType,
      name: body.name,
      description: body.description,
      status: body.status,
      createdBy: userId,
      updatedBy: userId,
    });
    return { success: true, message: 'Permission created successfully', permission: toSnakeCaseResponse(permission) };
  }

  @Put(':id_or_code')
  async update(
    @Param('feature_id') featureId: string,
    @Param('id_or_code') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateFeaturePermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const fields = permissionRequestToInternal(body as unknown as Record<string, unknown>) as {
      featureId?: string; permissionCode?: string; permissionType?: PermissionType; name?: string; description?: string; status?: RecordStatus;
    };
    const targetFeatureId = fields.featureId || featureId;
    const permission = await this.repository.updateFeaturePermission(idOrCode, featureId, {
      ...fields,
      featureId: targetFeatureId,
      updatedBy: auditUserId(request),
    }, true);
    if (!permission) {
      throw new NotFoundException(`Permission '${idOrCode}' not found`);
    }
    return { success: true, message: 'Permission updated successfully', permission: toSnakeCaseResponse(permission) };
  }

  @Patch(':id_or_code')
  patch(
    @Param('feature_id') featureId: string,
    @Param('id_or_code') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateFeaturePermissionDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateFeaturePermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.update(featureId, idOrCode, body, request);
  }

  @Put(':id_or_code/status')
  replaceStatus(
    @Param('feature_id') featureId: string,
    @Param('id_or_code') idOrCode: string,
    @Body(statusValidation) body: PermissionStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.updateStatus(featureId, idOrCode, body, request);
  }

  @Patch(':id_or_code/status')
  async updateStatus(
    @Param('feature_id') featureId: string,
    @Param('id_or_code') idOrCode: string,
    @Body(statusValidation) body: PermissionStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const permission = await this.repository.updateFeaturePermission(
      idOrCode,
      featureId,
      { status: body.status, updatedBy: auditUserId(request) },
      true,
    );
    if (!permission) throw new NotFoundException(`Permission '${idOrCode}' not found`);
    return { success: true, message: `Permission status updated to ${body.status}`, permission: toSnakeCaseResponse(permission) };
  }

  @Delete(':id_or_code')
  async delete(@Param('feature_id') featureId: string, @Param('id_or_code') idOrCode: string, @Req() request: AuthenticatedRequest) {
    await this.scoped(featureId, idOrCode);
    await this.repository.deleteFeaturePermission(idOrCode, featureId, auditUserId(request));
    return { success: true, message: 'Permission deactivated successfully' };
  }
}