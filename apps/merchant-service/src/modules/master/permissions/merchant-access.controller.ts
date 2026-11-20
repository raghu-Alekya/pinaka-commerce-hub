import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ConsoleAccessService } from '../../shared/console-access.service';
import type { ConsoleGrant } from '../../shared/console-access';

type AccessRequest = {
  user?: {
    accountType?: string;
    merchantId?: string;
    merchantCode?: string;
    employeeId?: string;
    id?: string;
  };
};

@Controller([
  'api/v1/merchants/:merchantId/access',
  'connector/api/v1/merchants/:merchantId/access',
])
export class MerchantAccessController {
  constructor(@Inject(ConsoleAccessService) private readonly access: ConsoleAccessService) {}

  @Get('modules')
  modules() {
    return this.access.modules();
  }

  @Get('employees')
  employees(@Param('merchantId') merchantId: string) {
    return this.access.listEmployees(merchantId);
  }

  @Put('employees/:employeeId/role')
  assignRole(
    @Param('merchantId') merchantId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: { roleId?: string; storeId?: string },
    @Req() request: AccessRequest,
  ) {
    return this.access.assignEmployeeRole(merchantId, employeeId, String(body?.roleId || ''), body?.storeId, request.user);
  }

  @Get('roles/:roleId/grants')
  grants(@Param('merchantId') merchantId: string, @Param('roleId') roleId: string, @Req() request: AccessRequest) {
    return this.access.roleGrants(merchantId, roleId, request.user);
  }

  @Put('roles/:roleId/grants')
  saveGrants(
    @Param('merchantId') merchantId: string,
    @Param('roleId') roleId: string,
    @Body() body: { grants?: ConsoleGrant[] },
    @Req() request: AccessRequest,
  ) {
    return this.access.saveRoleGrants(merchantId, roleId, body?.grants || [], request.user);
  }
}
