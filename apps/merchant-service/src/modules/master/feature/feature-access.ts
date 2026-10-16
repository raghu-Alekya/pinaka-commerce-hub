export const FEATURE_VERTICALS = ['RETAIL', 'RESTAURANT', 'BOTH'] as const;
export type FeatureVertical = (typeof FEATURE_VERTICALS)[number];
export const ADDON_BILLING_TYPES = ['ADDON_MONTHLY', 'ONE_TIME', 'PROMOTIONAL'] as const;
export type AddonBillingType = (typeof ADDON_BILLING_TYPES)[number];

export function parseVertical(value: unknown): FeatureVertical | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toUpperCase();
  return FEATURE_VERTICALS.includes(normalized as FeatureVertical) ? normalized as FeatureVertical : undefined;
}

export function storeVertical(storeTypeCode?: string | null): Exclude<FeatureVertical, 'BOTH'> {
  return String(storeTypeCode || '').trim().toUpperCase() === 'RESTAURANT' ? 'RESTAURANT' : 'RETAIL';
}

export function matchesVertical(featureStoreType: string | null | undefined, storeTypeCode: string | null | undefined) {
  const feature = parseVertical(featureStoreType) || 'BOTH';
  return feature === 'BOTH' || feature === storeVertical(storeTypeCode);
}

export function filterByStoreVertical<T extends { storeType?: string | null }>(items: T[], storeType?: string) {
  const vertical = parseVertical(storeType);
  if (!vertical) return items;
  if (vertical === 'BOTH') return items.filter(item => (parseVertical(item.storeType) || 'BOTH') === 'BOTH');
  return items.filter(item => matchesVertical(item.storeType, vertical));
}

export function canAccessFeature(input: {
  featureId: string;
  feature?: { storeType?: string | null; status?: string | null } | null;
  storeTypeCode?: string | null;
  override?: { isEnabled?: boolean; enabled?: boolean } | null;
  planFeatureIds: string[];
}): { allowed: boolean; reason: string } {
  if (!input.feature) return { allowed: false, reason: 'FEATURE_NOT_FOUND' };
  if (input.feature.status && input.feature.status !== 'ACTIVE') return { allowed: false, reason: 'FEATURE_INACTIVE' };
  if (!matchesVertical(input.feature.storeType, input.storeTypeCode)) {
    return { allowed: false, reason: 'FEATURE_VERTICAL_MISMATCH' };
  }
  if (input.override) {
    const enabled = input.override.isEnabled ?? input.override.enabled;
    return enabled ? { allowed: true, reason: 'ALLOWED' } : { allowed: false, reason: 'STORE_FEATURE_DISABLED' };
  }
  const entitled = input.planFeatureIds.some(id => id.toLowerCase() === input.featureId.toLowerCase());
  return entitled ? { allowed: true, reason: 'ALLOWED' } : { allowed: false, reason: 'FEATURE_NOT_ENTITLED' };
}
