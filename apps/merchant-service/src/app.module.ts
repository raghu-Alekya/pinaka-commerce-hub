import { Module } from '@nestjs/common';
import { DynamicQueryModule } from './modules/dynamic-query/dynamic-query.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { MasterModule } from './modules/master/master.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { PosModule } from './pos/pos.module';
import { RelationshipsModule } from './modules/shared/relationships.module';
import { StoreModule } from './modules/store/store.module';
import { StorePosConfigurationModule } from './modules/store-pos-configuration/store-pos-configuration.module';
import { VendorModule } from './modules/vendor/vendor.module';
import { DeviceModule } from './modules/device/device.module';

/**
 * Application composition root.
 *
 * Business functionality is now grouped by module:
 * - Master: store setup, features, permissions, role templates, plans, tenders
 * - Merchant
 * - Store
 * - Employee
 * - Vendor
 * - Dynamic Query
 * - POS
 * - Store POS configuration
 * - Shared relationship infrastructure
 *
 * Existing controllers/services/repositories were moved into these modules;
 * their route decorators and function implementations are unchanged.
 */
@Module({
  imports: [
    MerchantModule,
    StoreModule,
    EmployeeModule,
    VendorModule,
    MasterModule,
    RelationshipsModule,
    DynamicQueryModule,
    PosModule,
    StorePosConfigurationModule,
    DeviceModule,
  ],
})
export class AppModule {}
