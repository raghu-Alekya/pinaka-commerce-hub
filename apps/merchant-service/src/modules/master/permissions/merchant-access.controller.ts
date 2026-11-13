import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Put, Req } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { ConsoleAccessService } from '../../shared/console-access.service';
import { moduleCatalog } from '../../shared/console-access';
import { MenuPermissionService } from './menu-permission.service';

type AccessRequest = {
  user?: {
    id?: string;
    accountType?: string;
    merchantId?: string;
    employeeId?: string;
    merchantCode?: string;
  };
};

@Controller([
  'api/v1/merchants/:merchantId/access',
  'connector/api/v1/merchants/:merchantId/access',
])
export class MerchantAccessController {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(ConsoleAccessService) private readonly access: ConsoleAccessService,
    @Inject(MenuPermissionService) private readonly menus: MenuPermissionService,
  ) {}

  @Get('modules')
  modules() {
    return { success: true, modules: moduleCatalog() };
  }

  @Get('employees')
  employees(@Param('merchantId') merchantId: string) {
    return this.access.listAccessEmployees(merchantId);
  }

  @Put('employees/:employeeId/role')
  assignRole(
    @Param('merchantId') merchantId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: { roleId?: string; storeId?: string },
    @Req() request: AccessRequest,
  ) {
    if (!body?.roleId) throw new NotFoundException('roleId is required');
    return this.access.assignEmployeeRole(merchantId, employeeId, body.roleId, body.storeId, request.user);
  }

  @Get('roles/:roleId/grants')
  async grants(@Param('merchantId') merchantId: string, @Param('roleId') roleId: string) {
    const role = await this.requireRole(merchantId, roleId);
    const saved = await this.menus.get('MERCHANT_EMPLOYEE', role.id);
    return { success: true, role, grants: saved.grants, configured: saved.configured };
  }

  @Put('roles/:roleId/grants')
  async saveGrants(
    @Param('merchantId') merchantId: string,
    @Param('roleId') roleId: string,
    @Body() body: { grants?: { menuKey: string; actions: string[] }[] },
    @Req() request: AccessRequest,
  ) {
    const role = await this.requireRole(merchantId, roleId);
    if (request.user?.accountType === 'employee') {
      const held = await this.access.employeeGrants(request.user.employeeId || '', request.user.merchantId || merchantId);
      const managing = held.some((grant) => grant.menuKey === 'access-permissions' && grant.actions.includes('update'));
      if (!managing) throw new ForbiddenException('You cannot change access permissions');
    }
    const grants = await this.access.filterGrantsForActor(request.user, body?.grants || []);
    const saved = await this.menus.save({
      principalRole: 'MERCHANT_EMPLOYEE',
      roleTemplateId: role.id,
      grants,
    });
    return { success: true, role, grants: saved.grants };
  }

  private async requireRole(merchantId: string, roleId: string) {
    const role = await this.merchants.getRoleByIdOrCode(merchantId, roleId);
    if (!role || String(role.status).toUpperCase() === 'INACTIVE') {
      throw new NotFoundException(`Role '${roleId}' not found for merchant '${merchantId}'`);
    }
    return role;
  }
}
