import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { StoreTypeController } from './store-type.controller';
import { FeatureController } from './feature.controller';
import { PermissionController } from './permission.controller';
import { RoleTemplateController } from './role-template.controller';
import { PlanController } from './plan.controller';
import { RoleController } from './role.controller';
import { EmployeeController } from './employee.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { ReferenceDataController } from './reference-data.controller';
import { MerchantRepository } from './merchant.repository';

@Module({
  imports: [],
  controllers: [
    AppController,
    StoreTypeController,
    FeatureController,
    PermissionController,
    RoleTemplateController,
    PlanController,
    RoleController,
    EmployeeController,
    SubscriptionController,
    SubscriptionPlanController,
    ReferenceDataController,
  ],
  providers: [MerchantRepository],
  exports: [MerchantRepository],
})
export class AppModule {}
