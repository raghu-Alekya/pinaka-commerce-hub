import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { RelationshipOwnerGuard } from './relationships.controller';

@Controller('api/v1/merchants/:merchantId/stores/:storeId/roles/available')
@UseGuards(RelationshipOwnerGuard)
export class EmployeeStoreRoleCatalogController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Param('storeId') storeId: string) {
    const resolved = await this.repository.resolveMerchantId(merchantId);
    if (!resolved) return { success: true, count: 0, roles: [] };
    const roles = await this.repository.listRolesAvailableForStore(resolved, storeId);
    return { success: true, count: roles.length, roles };
  }
}
