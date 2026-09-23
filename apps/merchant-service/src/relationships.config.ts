export type Field = { column: string; kind: 'boolean' | 'integer' | 'string' | 'object' | 'date' | 'status'; nullable?: boolean; default?: unknown };
export type Relationship = {
  name: string; path: string; table: string; parentTable: string; parentParam: string;
  parentColumn: string; parentUuid?: boolean; ownerColumn?: string;
  childTable: string; childKey: string; childColumn: string; childUuid?: boolean;
  tenantColumn?: boolean; timestamps?: boolean; fields: Record<string, Field>;
  tenantField?: string; childOwnerColumn?: string; createdColumn?: string; updatedColumn?: string;
};
const storeTypeDefaults: Record<string, Field> = {
  defaultEnabled: { column: 'default_enabled', kind: 'boolean', default: false },
  required: { column: 'required', kind: 'boolean', default: false },
};
const entitlement: Record<string, Field> = {
  enabled: { column: 'enabled', kind: 'boolean', default: false },
  limitValue: { column: 'limitValue', kind: 'string', nullable: true, default: null },
};
const overrides: Record<string, Field> = {
  ...entitlement,
  source: { column: 'source', kind: 'string', nullable: true, default: null },
  effectiveFrom: { column: 'effectiveFrom', kind: 'date', nullable: true, default: null },
  effectiveUntil: { column: 'effectiveUntil', kind: 'date', nullable: true, default: null },
};

// Only these fixed identifiers are interpolated into SQL; request values are parameters.
export const RELATIONSHIPS: Relationship[] = [
  { name: 'StoreTypeFeatures', path: 'api/v1/store-types/:storeTypeId/features', table: 'store_type_features',
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'store_type_id', parentUuid: true,
    childTable: 'features', childKey: 'featureId', childColumn: 'feature_id', childUuid: true, timestamps: true,
    createdColumn: 'created_at', updatedColumn: 'updated_at',
    fields: { ...storeTypeDefaults, displayOrder: { column: 'display_order', kind: 'integer', nullable: true, default: null },
      configurationJson: { column: 'configuration_json', kind: 'object', nullable: true, default: null } } },
  { name: 'FeatureStoreTypes', path: 'api/v1/features/:featureId/store-types', table: 'store_type_features',
    parentTable: 'features', parentParam: 'featureId', parentColumn: 'feature_id', parentUuid: true,
    childTable: 'store_types', childKey: 'storeTypeId', childColumn: 'store_type_id', childUuid: true, timestamps: true,
    createdColumn: 'created_at', updatedColumn: 'updated_at',
    fields: { ...storeTypeDefaults, displayOrder: { column: 'display_order', kind: 'integer', nullable: true, default: null },
      configurationJson: { column: 'configuration_json', kind: 'object', nullable: true, default: null } } },
  { name: 'StoreTypeRoleTemplates', path: 'api/v1/store-types/:storeTypeId/role-templates', table: 'store_type_role_templates',
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'store_type_id', parentUuid: true,
    childTable: 'role_templates', childKey: 'roleTemplateId', childColumn: 'role_template_id', childUuid: true, timestamps: true,
    createdColumn: 'created_at', updatedColumn: 'updated_at', fields: storeTypeDefaults },
  { name: 'RoleTemplateStoreTypes', path: 'api/v1/role-templates/:roleTemplateId/store-types', table: 'store_type_role_templates',
    parentTable: 'role_templates', parentParam: 'roleTemplateId', parentColumn: 'role_template_id', parentUuid: true,
    childTable: 'store_types', childKey: 'storeTypeId', childColumn: 'store_type_id', childUuid: true, timestamps: true,
    createdColumn: 'created_at', updatedColumn: 'updated_at', fields: storeTypeDefaults },
  { name: 'PlanEntitlements', path: 'api/v1/plans/:planId/entitlements', table: 'plan_entitlements',
    parentTable: 'plans', parentParam: 'planId', parentColumn: 'planId', parentUuid: true,
    childTable: 'features', childKey: 'featureId', childColumn: 'featureId', childUuid: true, timestamps: true,
    fields: { ...entitlement, configurationJson: { column: 'configurationJson', kind: 'object', nullable: true, default: null } } },
  { name: 'SubscriptionStores', path: 'api/v1/merchants/:merchantId/subscriptions/:subscriptionId/stores', table: 'subscription_stores',
    parentTable: 'subscriptions', parentParam: 'subscriptionId', parentColumn: 'subscriptionId', ownerColumn: 'merchantId',
    childTable: 'stores', childKey: 'storeId', childColumn: 'storeId', tenantColumn: true,
    fields: { status: { column: 'status', kind: 'status', default: 'ACTIVE' },
      activatedAt: { column: 'activatedAt', kind: 'date', nullable: true, default: null },
      deactivatedAt: { column: 'deactivatedAt', kind: 'date', nullable: true, default: null } } },
  { name: 'SubscriptionEntitlements', path: 'api/v1/merchants/:merchantId/subscriptions/:subscriptionId/entitlements', table: 'subscription_entitlements',
    parentTable: 'subscriptions', parentParam: 'subscriptionId', parentColumn: 'subscriptionId', ownerColumn: 'merchantId',
    childTable: 'features', childKey: 'featureId', childColumn: 'featureId', childUuid: true, timestamps: true, fields: overrides },
  { name: 'StoreEntitlements', path: 'api/v1/merchants/:merchantId/stores/:storeId/entitlements', table: 'store_entitlements',
    parentTable: 'stores', parentParam: 'storeId', parentColumn: 'storeId', ownerColumn: 'merchantId',
    childTable: 'features', childKey: 'featureId', childColumn: 'featureId', childUuid: true, timestamps: true, fields: overrides },
];

const assignment: Record<string, Field> = {
  status: { column: 'status', kind: 'status', default: 'ACTIVE' },
  effectiveFrom: { column: 'effective_from', kind: 'date', nullable: true, default: null },
  effectiveUntil: { column: 'effective_until', kind: 'date', nullable: true, default: null },
};
const audit = { timestamps: true, createdColumn: 'created_at', updatedColumn: 'updated_at' };
export const EMPLOYEE_ACCESS_RELATIONSHIPS: Relationship[] = [
  { name: 'EmployeeStores', path: 'api/v1/merchants/employees/:employeeId/stores', table: 'employee_stores',
    parentTable: 'employees', parentParam: 'employeeId', parentColumn: 'employee_id', parentUuid: true, ownerColumn: 'merchant_id',
    childTable: 'stores', childKey: 'storeId', childColumn: 'store_id', childUuid: true, tenantColumn: true, tenantField: 'merchant_id', childOwnerColumn: 'merchant_uuid',
    ...audit, fields: { isPrimary: { column: 'is_primary', kind: 'boolean', default: false }, ...assignment } },
  { name: 'EmployeeStoreRoles', path: 'api/v1/merchants/employees/employee-stores/:employeeStoreId/roles', table: 'employee_store_roles',
    parentTable: 'employee_stores', parentParam: 'employeeStoreId', parentColumn: 'employee_store_id', parentUuid: true, ownerColumn: 'merchant_id',
    childTable: 'roles', childKey: 'roleId', childColumn: 'role_id', childUuid: true, tenantColumn: true, tenantField: 'merchant_id', childOwnerColumn: 'merchant_id',
    ...audit, fields: assignment },
  { name: 'RoleTemplatePermissions', path: 'api/v1/role-templates/:roleTemplateId/permissions', table: 'role_template_permissions',
    parentTable: 'role_templates', parentParam: 'roleTemplateId', parentColumn: 'role_template_id', parentUuid: true,
    childTable: 'permissions', childKey: 'permissionId', childColumn: 'permission_id', childUuid: true,
    ...audit, fields: { defaultAllowed: { column: 'default_allowed', kind: 'boolean', default: false } } },
  { name: 'RolePermissions', path: 'api/v1/merchants/:merchantId/roles/:roleId/permissions', table: 'role_permissions',
    parentTable: 'roles', parentParam: 'roleId', parentColumn: 'role_id', parentUuid: true, ownerColumn: 'merchant_id',
    childTable: 'permissions', childKey: 'permissionId', childColumn: 'permission_id', childUuid: true,
    tenantColumn: true, tenantField: 'merchant_id',
    ...audit, fields: {
      storeId: { column: 'store_id', kind: 'string' },
      allowed: { column: 'allowed', kind: 'boolean', default: false },
    } },
];
