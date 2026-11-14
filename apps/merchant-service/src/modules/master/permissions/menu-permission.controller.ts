import { Body, Controller, Get, Inject, Put, Query } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
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

  @Put()
  save(
    @Body()
    body: {
      principalRole?: string;
      roleTemplateId?: string | null;
      menuKeys?: string[];
      grants?: { menuKey: string; actions: string[] }[];
    },
  ) {
    return this.service.save(body);
  }
}
