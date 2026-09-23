import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { RelationshipOwnerGuard } from './relationships.controller';

@Controller('api/v1/merchants/employees/stores/:storeId/roles/available')
@UseGuards(RelationshipOwnerGuard)
export class EmployeeStoreRoleCatalogController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('storeId') storeId: string) {
    const roles = await this.repository.listRolesAvailableForStore(storeId);
    return { success: true, count: roles.length, roles };
  }
}
