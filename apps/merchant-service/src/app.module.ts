import { OnboardingController } from './onboarding.controller';
import { VendorController } from './vendor.controller';
import { TendorController } from './tendor.controller';
import { VendorRepository } from './vendor.repository';
import { TendorRepository } from './tendor.repository';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MerchantResponseRelationsInterceptor } from './merchant-response-relations.interceptor';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { MerchantRoleTemplateController } from './merchant-role-template.controller';
import { RolePermissionController } from './role-permission.controller';
import { EmployeeController } from './employee.controller';
import { MerchantEmployeeController } from './merchant-employee.controller';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessRepository } from './employee-access.repository';
import { EmployeeStoreRoleCatalogController } from './employee-store-role-catalog.controller';
import { AppController } from './app.controller';
import { MerchantRepository } from './merchant.repository';
import { CompactMerchantController } from './compact-merchant.controller';
import { CompactSubscriptionController } from './compact-subscription.controller';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { ReferenceDataController } from './reference-data.controller';
import { DeviceController } from './device.controller';
import { StoreTypeController } from './store-type.controller';
import { FeatureStoreTypeCatalogController, StoreTypeFeatureCatalogController, StoreTypeRoleTemplateCatalogController } from './store-type-mapping.controller';
import { RoleTemplateFeatureAccessController, RoleTemplateStoreTypeBulkController, RoleTemplateStoreTypeCatalogController } from './role-template-mapping.controller';
import { FeaturePermissionController } from './feature-permission.controller';
import { FeatureController, RoleTemplateController, PlanController } from './master-data.controller';
import { SessionAuthGuard } from './session-auth.guard';
import { RELATIONSHIP_CONTROLLERS, RelationshipOwnerGuard, RoleTemplatePermissionsReplaceController } from './relationships.controller';
import { RelationshipsRepository } from './relationships.repository';


@Module({
  imports: [],
  controllers: [
    CompactMerchantController,
    CompactSubscriptionController,
    StoreTypeFeatureCatalogController,
    FeatureStoreTypeCatalogController,
    StoreTypeRoleTemplateCatalogController,
    RoleTemplateStoreTypeCatalogController,
    RoleTemplateStoreTypeBulkController,
    RoleTemplateFeatureAccessController,
    RoleTemplatePermissionsReplaceController,
    EmployeeController,
    MerchantEmployeeController,
    EmployeeAccessController,
    EmployeeStoreRoleCatalogController,
    MerchantRoleTemplateController,
    RolePermissionController,
    ...RELATIONSHIP_CONTROLLERS,
    AppController,
    FeaturePermissionController,
    PermissionController,
    RoleController,
    SubscriptionPlanController,
    ReferenceDataController,
    DeviceController,
    StoreTypeController,
    OnboardingController,
    VendorController,
    TendorController,
    FeatureController,
    RoleTemplateController,
    PlanController,
  ],
  exports: [MerchantRepository],
  providers: [
    RelationshipsRepository,
    EmployeeAccessRepository,
    RelationshipOwnerGuard,
    MerchantRepository,
    VendorRepository,
    TendorRepository,
    SessionAuthGuard,
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: MerchantResponseRelationsInterceptor },
  ],
})
export class AppModule {}
