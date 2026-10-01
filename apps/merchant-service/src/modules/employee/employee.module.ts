import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessRepository } from './employee-access.repository';
import { EmployeeStoreRoleCatalogController } from './employee-store-role-catalog.controller';
import { MerchantEmployeeController } from './merchant-employee.controller';
import { MerchantModule } from '../merchant/merchant.module';
import { RelationshipsModule } from '../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    EmployeeController,
    MerchantEmployeeController,
    EmployeeAccessController,
    EmployeeStoreRoleCatalogController,
  ],
  providers: [EmployeeAccessRepository],
})
export class EmployeeModule {}
