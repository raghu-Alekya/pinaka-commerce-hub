import { BadRequestException } from '@nestjs/common';

/** Shared filters used by the Master Setup list screens. */
export function filterMasterList<T extends object>(items: T[], query: Record<string, string> = {}): T[] {
  for (const key of ['status', 'billingModel', 'category', 'search']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') {
      throw new BadRequestException(`${key} must be a single string`);
    }
  }
  const status = query.status?.trim().toUpperCase();
  if (status && !['ACTIVE', 'INACTIVE', 'ALL STATUSES'].includes(status)) {
    throw new BadRequestException('Invalid status');
  }
  const billingModel = query.billingModel?.trim().toUpperCase().replace(/\s+/g, '_').replace(/^FLAT_RATE$/, 'FLAT');
  if (billingModel && !['PER_STORE', 'PER_DEVICE', 'FLAT', 'CUSTOM'].includes(billingModel)) {
    throw new BadRequestException('Invalid billingModel');
  }
  const search = query.search?.trim().toLowerCase();
  return items.filter((item) => {
    const row = item as Record<string, unknown>;
    return (!status || status === 'ALL STATUSES' || row.status === status)
      && (!query.category || query.category === 'All Categories' || row.category === query.category)
      && (!billingModel || row.billingModel === billingModel)
      && (!search || ['name', 'description', 'category', 'featureKey', 'storeTypeCode', 'roleCode', 'planCode']
        .some((key) => String(row[key] ?? '').toLowerCase().includes(search)));
  });
}

export function groupFeaturesByCategory<T extends { category?: string | null }>(features: T[]) {
  const groups = new Map<string, T[]>();
  for (const feature of features) {
    const category = feature.category?.trim() || 'Uncategorized';
    const list = groups.get(category) || [];
    list.push(feature);
    groups.set(category, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, items]) => ({ category, count: items.length, features: items }));
}
