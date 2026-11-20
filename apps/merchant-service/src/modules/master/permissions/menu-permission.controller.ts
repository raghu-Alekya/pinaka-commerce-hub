import { Body, Controller, ForbiddenException, Get, Inject, Put, Query, Req } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { RequireAuth } from '../../shared/session-auth.guard';
import { MenuPermissionService } from './menu-permission.service';

@Public()
@Controller([
  'api/v1/menu-permissions',
  'connector/api/v1/menu-permissions',
  'menu-permissions',
])
export class MenuPermissionController {
  constructor(
    @Inject(MenuPermissionService) private readonly service: MenuPermissionService,
  ) {}

  @Get()
  get(
    @Query('principalRole') principalRole?: string,
    @Query('roleTemplateId') roleTemplateId?: string,
  ) {
    return this.service.get(principalRole, roleTemplateId);
  }

  @RequireAuth()
  @Put()
  save(
    @Body()
    body: {
      principalRole?: string;
      roleTemplateId?: string | null;
      menuKeys?: string[];
      grants?: { menuKey: string; actions: string[] }[];
    },
    @Req() request: { user?: { accountType?: string } },
  ) {
    if (request.user?.accountType === 'merchant' || request.user?.accountType === 'employee') {
      throw new ForbiddenException('Use Access & Permissions to change a merchant role');
    }
    return this.service.save(body);
  }
}
