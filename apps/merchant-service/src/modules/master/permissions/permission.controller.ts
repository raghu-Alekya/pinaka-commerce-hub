import { WorkforceValidationPipe } from '../../employee/workforce-validation.pipe';
import { CanActivate, Controller, Delete, ExecutionContext, Get, Inject, Injectable, Param, Patch, Post, Put, Query, Body, NotFoundException, UseGuards } from '@nestjs/common';
import { extractBearerToken, verifyAccessToken } from '@pinaka-delivery-hub/auth';
import { RelationshipOwnerGuard } from '../../shared/relationships.controller';
import { RequireAuth } from '../../shared/session-auth.guard';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { CreatePermissionDto, UpdatePermissionDto } from './permission.dto';

@Injectable()
class PermissionBearerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const authorization = context.switchToHttp().getRequest().headers?.authorization;
    verifyAccessToken(extractBearerToken(authorization));
    return true;
  }
}

@RequireAuth()
@UseGuards(PermissionBearerGuard, RelationshipOwnerGuard)
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
