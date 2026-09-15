export type Field = { column: string; kind: 'boolean' | 'integer' | 'string' | 'object' | 'date' | 'status'; nullable?: boolean; default?: unknown };
export type Relationship = {
  name: string; path: string; table: string; parentTable: string; parentParam: string;
  parentColumn: string; parentUuid?: boolean; ownerColumn?: string;
  childTable: string; childKey: string; childColumn: string; childUuid?: boolean;
  tenantColumn?: boolean; timestamps?: boolean; fields: Record<string, Field>;
};
const defaults: Record<string, Field> = {
  defaultEnabled: { column: 'defaultEnabled', kind: 'boolean', default: false },
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
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'storeTypeId', parentUuid: true,
    childTable: 'features', childKey: 'featureId', childColumn: 'featureId', childUuid: true, timestamps: true,
    fields: { ...defaults, displayOrder: { column: 'displayOrder', kind: 'integer', nullable: true, default: null },
      configurationJson: { column: 'configurationJson', kind: 'object', nullable: true, default: null } } },
  { name: 'StoreTypeRoleTemplates', path: 'api/v1/store-types/:storeTypeId/role-templates', table: 'store_type_role_templates',
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'storeTypeId', parentUuid: true,
    childTable: 'role_templates', childKey: 'roleTemplateId', childColumn: 'roleTemplateId', childUuid: true, timestamps: true, fields: defaults },
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
