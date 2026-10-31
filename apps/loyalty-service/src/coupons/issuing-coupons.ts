export type CatalogProduct = {
  id: number;
  storeId: string;
  parentId: number | null;
  type: string;
  categoryIds: number[];
};

export type IssuingCoupon = {
  id: string;
  storeId: string;
  code: string;
  discountType: string;
  amount: number;
  minAmount: number | null;
  maxAmount: number | null;
  generateType: string | null;
  generateLimit: number | null;
  expiryDate: string | null;
  enabled: boolean;
  usageLimit: number | null;
  usageCount: number;
  productIds: number[];
  excludedProductIds: number[];
  categoryIds: number[];
  excludedCategoryIds: number[];
};

export type IssuedCouponOrder = {
  couponId: string;
  storeId: string;
  orderId: string;
  orderStatus: string;
  completedAt: Date;
};

export type IssuingCouponResponse = {
  id: string;
  code: string;
  discount_type: string;
  amount: number;
  min_amount: number | null;
  max_amount: number | null;
  generate_type: string | null;
  generate_limit: number | null;
  expiry_date: string | null;
};

const GENERATE_TYPES = new Set(['daily', 'weekly', 'monthly', 'yearly']);

export function orderTotalFromLineItems(lineItems: unknown[]): number {
  let total = 0;
  for (const item of lineItems) {
    if (!item || typeof item !== 'object' || !('subtotal' in item)) continue;
    const subtotal = Number((item as { subtotal?: unknown }).subtotal);
    if (!Number.isFinite(subtotal)) continue;
    total += subtotal;
  }
  return roundMoney(total);
}

export function selectIssuingCoupons(input: {
  lineItems: unknown[];
  orderTotal: number;
  coupons: IssuingCoupon[];
  products: CatalogProduct[];
  issuances: IssuedCouponOrder[];
  now?: Date;
}): IssuingCouponResponse[] {
  const now = input.now ?? new Date();
  const selected: IssuingCouponResponse[] = [];
  for (const coupon of input.coupons) {
    if (!coupon.enabled) continue;
    if (outsideAmount(input.orderTotal, coupon)) continue;
    if (isExpired(coupon.expiryDate, now)) continue;
    if (usageReached(coupon)) continue;
    const cart = cartTargets(input.lineItems, productsForStore(input.products, coupon.storeId));
    if (!productsAndCategoriesPass(coupon, cart)) continue;
    if (generateLimitReached(coupon, input.issuances, now)) continue;
    selected.push(toResponse(coupon));
  }
  return selected;
}

export function cartTargets(
  lineItems: unknown[],
  products: CatalogProduct[],
): { productIds: number[]; categoryIds: number[] } {
  const catalog = new Map(products.map((product) => [product.id, product]));
  const productIds: number[] = [];
  const categoryIds: number[] = [];
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { product_id?: unknown; variation_id?: unknown };
    const variationId = positiveId(record.variation_id);
    const productId = positiveId(record.product_id);
    const cartProductId = variationId ?? productId;
    if (!cartProductId) continue;
    productIds.push(cartProductId);
    const catalogProduct = catalog.get(cartProductId);
    const parentFromCatalog = positiveId(catalogProduct?.parentId);
    const isVariation = variationId !== null
      || parentFromCatalog !== null
      || catalogProduct?.type === 'variation';
    const categorySourceId = categorySource(isVariation, variationId, productId, parentFromCatalog, cartProductId);
    if (!categorySourceId) continue;
    categoryIds.push(...(catalog.get(categorySourceId)?.categoryIds ?? []));
  }
  return { productIds: unique(productIds), categoryIds: unique(categoryIds) };
}

export function catalogLookupIds(lineItems: unknown[]): number[] {
  const ids: number[] = [];
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { product_id?: unknown; variation_id?: unknown };
    const variationId = positiveId(record.variation_id);
    const productId = positiveId(record.product_id);
    if (variationId) ids.push(variationId);
    if (productId) ids.push(productId);
  }
  return unique(ids);
}

export function periodStart(generateType: string | null, now: Date): Date | null {
  const type = generateType?.toLowerCase() ?? '';
  if (!GENERATE_TYPES.has(type)) return null;
  const start = new Date(now.getTime());
  start.setHours(0, 0, 0, 0);
  if (type === 'daily') return start;
  if (type === 'weekly') {
    const day = start.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - daysFromMonday);
    return start;
  }
  if (type === 'monthly') {
    start.setDate(1);
    return start;
  }
  start.setMonth(0, 1);
  return start;
}

export function positiveId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function categorySource(
  isVariation: boolean,
  variationId: number | null,
  productId: number | null,
  parentFromCatalog: number | null,
  cartProductId: number,
): number | null {
  if (!isVariation) return cartProductId;
  if (productId && variationId && productId !== variationId) return productId;
  return parentFromCatalog;
}

function productsForStore(products: CatalogProduct[], storeId: string): CatalogProduct[] {
  return products.filter((product) => product.storeId === storeId);
}

function outsideAmount(orderTotal: number, coupon: IssuingCoupon): boolean {
  if (coupon.minAmount !== null && orderTotal < coupon.minAmount) return true;
  if (coupon.maxAmount !== null && orderTotal > coupon.maxAmount) return true;
  return false;
}

function isExpired(expiryDate: string | null, now: Date): boolean {
  if (!expiryDate) return false;
  return expiryDate < localDate(now);
}

function usageReached(coupon: IssuingCoupon): boolean {
  return coupon.usageLimit !== null && coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit;
}

function productsAndCategoriesPass(
  coupon: IssuingCoupon,
  cart: { productIds: number[]; categoryIds: number[] },
): boolean {
  if (coupon.productIds.length > 0 && !intersects(coupon.productIds, cart.productIds)) return false;
  if (intersects(coupon.excludedProductIds, cart.productIds)) return false;
  if (coupon.categoryIds.length > 0 && !intersects(coupon.categoryIds, cart.categoryIds)) return false;
  if (intersects(coupon.excludedCategoryIds, cart.categoryIds)) return false;
  return true;
}

function generateLimitReached(coupon: IssuingCoupon, issuances: IssuedCouponOrder[], now: Date): boolean {
  if (!coupon.generateType || coupon.generateLimit === null || coupon.generateLimit <= 0) return false;
  const after = periodStart(coupon.generateType, now);
  if (!after) return false;
  return countIssuedOrders(issuances, coupon, after, now) >= coupon.generateLimit;
}

function countIssuedOrders(
  issuances: IssuedCouponOrder[],
  coupon: IssuingCoupon,
  after: Date,
  now: Date,
): number {
  const orders = new Set<string>();
  for (const issuance of issuances) {
    if (issuance.couponId !== coupon.id || issuance.storeId !== coupon.storeId) continue;
    if (issuance.orderStatus.toLowerCase() !== 'completed') continue;
    if (issuance.completedAt < after || issuance.completedAt > now) continue;
    orders.add(issuance.orderId);
  }
  return orders.size;
}

function toResponse(coupon: IssuingCoupon): IssuingCouponResponse {
  return {
    id: String(coupon.id),
    code: coupon.code,
    discount_type: coupon.discountType,
    amount: coupon.amount,
    min_amount: coupon.minAmount,
    max_amount: coupon.maxAmount,
    generate_type: coupon.generateType,
    generate_limit: coupon.generateLimit,
    expiry_date: coupon.expiryDate,
  };
}

function intersects(left: number[], right: number[]): boolean {
  const ids = new Set(right);
  return left.some((id) => ids.has(id));
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}

function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
