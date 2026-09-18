import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { EmployeeAccessRepository } from './employee-access.repository';
import { RelationshipOwnerGuard } from './relationships.controller';

@Controller('api/v1/merchants/:merchantId/employees/:employeeId/stores/:storeId/effective-access')
@UseGuards(RelationshipOwnerGuard)
export class EmployeeAccessController {
  constructor(@Inject(EmployeeAccessRepository) private readonly repository: EmployeeAccessRepository) {}
  @Get()
  get(@Param('merchantId') merchantId: string, @Param('employeeId') employeeId: string,
    @Param('storeId') storeId: string, @Query('permissionKey') permissionKey?: string) {
    return this.repository.resolve(merchantId, employeeId, storeId, permissionKey);
  }
}
