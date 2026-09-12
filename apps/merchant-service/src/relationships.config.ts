export type Field = { column: string; kind: 'boolean' | 'integer' | 'string' | 'object' | 'date' | 'status'; nullable?: boolean; default?: unknown };
export type Relationship = {
  name: string; path: string; table: string; parentTable: string; parentParam: string;
  parentColumn: string; parentUuid?: boolean; ownerColumn?: string;
  childTable: string; childKey: string; childColumn: string; childUuid?: boolean;
  tenantColumn?: boolean; timestamps?: boolean; fields: Record<string, Field>;
};
const defaults: Record<string, Field> = {
  defaultEnabled: { column: 'default_enabled', kind: 'boolean', default: false },
  required: { column: 'required', kind: 'boolean', default: false },
};
const entitlement: Record<string, Field> = {
  enabled: { column: 'enabled', kind: 'boolean', default: false },
  limitValue: { column: 'limit_value', kind: 'string', nullable: true, default: null },
};
const overrides: Record<string, Field> = {
  ...entitlement,
  source: { column: 'source', kind: 'string', nullable: true, default: null },
  effectiveFrom: { column: 'effective_from', kind: 'date', nullable: true, default: null },
  effectiveUntil: { column: 'effective_until', kind: 'date', nullable: true, default: null },
};

// Only these fixed identifiers are interpolated into SQL; request values are parameters.
export const RELATIONSHIPS: Relationship[] = [
  { name: 'StoreTypeFeatures', path: 'api/v1/store-types/:storeTypeId/features', table: 'store_type_features',
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'store_type_id', parentUuid: true,
    childTable: 'features', childKey: 'featureId', childColumn: 'feature_id', childUuid: true, timestamps: true,
    fields: { ...defaults, displayOrder: { column: 'display_order', kind: 'integer', nullable: true, default: null },
      configurationJson: { column: 'configuration_json', kind: 'object', nullable: true, default: null } } },
  { name: 'StoreTypeRoleTemplates', path: 'api/v1/store-types/:storeTypeId/role-templates', table: 'store_type_role_templates',
    parentTable: 'store_types', parentParam: 'storeTypeId', parentColumn: 'store_type_id', parentUuid: true,
    childTable: 'role_templates', childKey: 'roleTemplateId', childColumn: 'role_template_id', childUuid: true, timestamps: true, fields: defaults },
  { name: 'PlanEntitlements', path: 'api/v1/plans/:planId/entitlements', table: 'plan_entitlements',
    parentTable: 'plans', parentParam: 'planId', parentColumn: 'plan_id', parentUuid: true,
    childTable: 'features', childKey: 'featureId', childColumn: 'feature_id', childUuid: true, timestamps: true,
    fields: { ...entitlement, configurationJson: { column: 'configuration_json', kind: 'object', nullable: true, default: null } } },
  { name: 'SubscriptionStores', path: 'api/v1/merchants/:merchantId/subscriptions/:subscriptionId/stores', table: 'subscription_stores',
    parentTable: 'subscriptions', parentParam: 'subscriptionId', parentColumn: 'subscription_id', ownerColumn: 'merchant_id',
    childTable: 'stores', childKey: 'storeId', childColumn: 'store_id', tenantColumn: true,
    fields: { status: { column: 'status', kind: 'status', default: 'ACTIVE' },
      activatedAt: { column: 'activated_at', kind: 'date', nullable: true, default: null },
      deactivatedAt: { column: 'deactivated_at', kind: 'date', nullable: true, default: null } } },
  { name: 'SubscriptionEntitlements', path: 'api/v1/merchants/:merchantId/subscriptions/:subscriptionId/entitlements', table: 'subscription_entitlements',
    parentTable: 'subscriptions', parentParam: 'subscriptionId', parentColumn: 'subscription_id', ownerColumn: 'merchant_id',
    childTable: 'features', childKey: 'featureId', childColumn: 'feature_id', childUuid: true, timestamps: true, fields: overrides },
  { name: 'StoreEntitlements', path: 'api/v1/merchants/:merchantId/stores/:storeId/entitlements', table: 'store_entitlements',
    parentTable: 'stores', parentParam: 'storeId', parentColumn: 'store_id', ownerColumn: 'merchant_id',
    childTable: 'features', childKey: 'featureId', childColumn: 'feature_id', childUuid: true, timestamps: true, fields: overrides },
];
