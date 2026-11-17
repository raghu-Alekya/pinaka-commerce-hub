const CUSTOM_CATEGORY_SLUG = 'custom-product';

type CategoryRecord = {
  id: string;
  parent: string;
  slug: string;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function categoryRecord(value: unknown): CategoryRecord | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id ?? item.term_id);
  if (!id) return null;
  return {
    id,
    parent: text(item.parent) ?? '0',
    slug: (text(item.slug) ?? '').toLowerCase(),
  };
}

/** Category ids for the POS custom-product category and its child categories. */
export function customCategoryIds(categories: unknown[]): string[] {
  const records = categories.flatMap((item) => {
    const category = categoryRecord(item);
    return category ? [category] : [];
  });
  const ids = new Set<string>();
  for (const category of records) {
    if (category.slug === CUSTOM_CATEGORY_SLUG) ids.add(category.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of records) {
      if (ids.has(category.parent) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

/** A product is custom when one of its category ids belongs to the custom category set. */
export function isCustomStoreProduct(
  product: Record<string, unknown>,
  customIds: ReadonlySet<string>,
): boolean {
  const direct = text(product.categoryId);
  if (direct && customIds.has(direct)) return true;
  if (!Array.isArray(product.categories)) return false;
  return product.categories.some((item) => {
    const category = record(item);
    if (!category) return false;
    const id = text(category.id ?? category.term_id);
    const slug = (text(category.slug) ?? '').toLowerCase();
    return (id !== null && customIds.has(id)) || slug === CUSTOM_CATEGORY_SLUG;
  });
}
