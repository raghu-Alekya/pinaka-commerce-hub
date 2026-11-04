export type LoyaltyMode = 'item' | 'order';

export interface LoyaltySettings {
  ratioDollar: number;
  ratioPoint: number;
  newCustomerPoints: number;
  defaultPoints: number;
  loyaltyTag: string;
  redeemPoint: number;
  redeemAmount: number;
  expiryDays: number;
  conflictRule: 'enable' | 'disable';
  minSpend: number;
  maxSpend: number;
  minPoints: number;
  maxPoints: number;
  redeemPercent: number;
  allowRedemption: boolean;
  mode: LoyaltyMode;
  payoutProductIds: string[];
  discountProductIds: string[];
  cashbackProductIds: string[];
  loyaltyProductIds: string[];
}

export interface LoyaltySettingsView {
  ratio_dollar: number;
  ratio_point: number;
  new_customer_points: number;
  default_points: number;
  loyalty_tag: string;
  mode: LoyaltyMode;
  redeem_point: number;
  redeem_amt: number;
  expiry_days: number;
  conflict_rule: 'enable' | 'disable';
  min_spend: number;
  max_spend: number;
  min_points: number;
  max_points: number;
  redeem_perc: number;
  allow_redemption: boolean;
}

export interface CatalogProduct {
  id: string;
  parentId?: string;
  name: string;
  tags: string[];
  points: number;
}

export interface OrderLine {
  id?: string;
  product_id?: unknown;
  productId?: unknown;
  variation_id?: unknown;
  variationId?: unknown;
  name?: unknown;
  quantity?: unknown;
  subtotal?: unknown;
  total?: unknown;
  meta_data?: Array<{ key?: string; value?: unknown }>;
  modifiers?: Array<{ key?: string; value?: unknown }>;
}

const SETTING_FIELDS = [
  'pinaka_loyalty_ratio_dollar',
  'pinaka_loyalty_ratio_point',
  'pinaka_new_customer_points',
  'pinaka_loyalty_expiry_days',
  'pinaka_loyalty_min_spend',
  'pinaka_loyalty_max_spend',
  'pinaka_loyalty_redeem_point',
  'pinaka_loyalty_redeem_amt',
  'pinaka_loyalty_min_points',
  'pinaka_loyalty_max_points',
  'pinaka_loyalty_redeem_perc',
] as const;

export function defaultLoyaltySettings(): LoyaltySettings {
  return {
    ratioDollar: 0,
    ratioPoint: 0,
    newCustomerPoints: 0,
    defaultPoints: 0,
    loyaltyTag: 'LoyaltyPoints',
    redeemPoint: 0,
    redeemAmount: 0,
    expiryDays: 365,
    conflictRule: 'enable',
    minSpend: 0,
    maxSpend: 0,
    minPoints: 0,
    maxPoints: 0,
    redeemPercent: 0,
    allowRedemption: true,
    mode: 'order',
    payoutProductIds: [],
    discountProductIds: [],
    cashbackProductIds: [],
    loyaltyProductIds: [],
  };
}

export function presentSettings(settings: LoyaltySettings): LoyaltySettingsView {
  return {
    ratio_dollar: settings.ratioDollar,
    ratio_point: settings.ratioPoint,
    new_customer_points: settings.newCustomerPoints,
    default_points: settings.defaultPoints,
    loyalty_tag: settings.loyaltyTag,
    mode: settings.mode,
    redeem_point: settings.redeemPoint,
    redeem_amt: settings.redeemAmount,
    expiry_days: settings.expiryDays,
    conflict_rule: settings.conflictRule,
    min_spend: settings.minSpend,
    max_spend: settings.maxSpend,
    min_points: settings.minPoints,
    max_points: settings.maxPoints,
    redeem_perc: settings.redeemPercent,
    allow_redemption: settings.allowRedemption,
  };
}

export function settingsFromStored(value: Record<string, unknown> | undefined): LoyaltySettings {
  const source = value || {};
  const settings = defaultLoyaltySettings();
  settings.ratioDollar = numberOr(source.pinaka_loyalty_ratio_dollar, 0);
  settings.ratioPoint = numberOr(source.pinaka_loyalty_ratio_point, 0);
  settings.newCustomerPoints = numberOr(source.pinaka_new_customer_points, 0);
  settings.defaultPoints = numberOr(source.pinaka_loyalty_default_points, settings.newCustomerPoints);
  settings.loyaltyTag = String(source.pinaka_loyalty_tag || 'LoyaltyPoints');
  settings.redeemPoint = numberOr(source.pinaka_loyalty_redeem_point, 0);
  settings.redeemAmount = numberOr(source.pinaka_loyalty_redeem_amt, 0);
  settings.expiryDays = numberOr(source.pinaka_loyalty_expiry_days, 365);
  settings.conflictRule = source.pinaka_loyalty_conflict_rule === 'disable' ? 'disable' : 'enable';
  settings.minSpend = numberOr(source.pinaka_loyalty_min_spend, 0);
  settings.maxSpend = numberOr(source.pinaka_loyalty_max_spend, 0);
  settings.minPoints = numberOr(source.pinaka_loyalty_min_points, 0);
  settings.maxPoints = numberOr(source.pinaka_loyalty_max_points, 0);
  settings.redeemPercent = numberOr(source.pinaka_loyalty_redeem_perc, 0);
  settings.allowRedemption = booleanOr(source.pinaka_loyalty_allow_redemption, settings.redeemPoint > 0 && settings.redeemAmount > 0);
  settings.mode = String(source.pinaka_loyalty_mode || 'order').toLowerCase() === 'item' ? 'item' : 'order';
  settings.payoutProductIds = idList(source.pinaka_payout_product_id);
  settings.discountProductIds = idList(source.pinaka_discount_product_id);
  settings.cashbackProductIds = idList(source.pinaka_cashback_product_id);
  settings.loyaltyProductIds = [...idList(source.pinaka_discount_loyalty_id), ...idList(source.pinaka_loyalty_product_id)];
  return settings;
}

export function storedSettingsPatch(settings: LoyaltySettings, previous: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...previous,
    pinaka_loyalty_ratio_dollar: settings.ratioDollar,
    pinaka_loyalty_ratio_point: settings.ratioPoint,
    pinaka_new_customer_points: settings.newCustomerPoints,
    pinaka_loyalty_default_points: settings.defaultPoints,
    pinaka_loyalty_tag: settings.loyaltyTag,
    pinaka_loyalty_mode: settings.mode,
    pinaka_loyalty_redeem_point: settings.redeemPoint,
    pinaka_loyalty_redeem_amt: settings.redeemAmount,
    pinaka_loyalty_expiry_days: settings.expiryDays,
    pinaka_loyalty_conflict_rule: settings.conflictRule,
    pinaka_loyalty_min_spend: settings.minSpend,
    pinaka_loyalty_max_spend: settings.maxSpend,
    pinaka_loyalty_min_points: settings.minPoints,
    pinaka_loyalty_max_points: settings.maxPoints,
    pinaka_loyalty_redeem_perc: settings.redeemPercent,
    pinaka_loyalty_allow_redemption: settings.allowRedemption,
  };
}

export function validateSettingsUpdate(body: Record<string, unknown>): { settings: LoyaltySettings } | { code: string; message: string } {
  const values: Record<string, number> = {};
  for (const field of SETTING_FIELDS) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return { code: 'missing_field', message: `Missing required field: ${field}` };
    }
    const parsed = nonNegativeInteger(body[field]);
    if (parsed === undefined) {
      return {
        code: 'invalid_integer_field',
        message: `The field "${field}" must be an integer value. Given: ${String(body[field])}`,
      };
    }
    values[field] = parsed;
  }
  const conflict = body.pinaka_loyalty_conflict_rule;
  if (conflict !== 'enable' && conflict !== 'disable') {
    return {
      code: 'invalid_parameter',
      message: 'The "pinaka_loyalty_conflict_rule" value must be enable or disable',
    };
  }
  const allowRedemption = booleanValue(body.pinaka_loyalty_allow_redemption);
  if (allowRedemption === undefined) {
    return { code: 'invalid_parameter', message: 'The field "pinaka_loyalty_allow_redemption" must be boolean.' };
  }
  if (values.pinaka_loyalty_redeem_perc > 100) {
    return {
      code: 'invalid_percentage',
      message: 'The "pinaka_loyalty_redeem_perc" value must not exceed 100.',
    };
  }
  if (values.pinaka_loyalty_min_spend > values.pinaka_loyalty_max_spend) {
    return {
      code: 'invalid_spend_range',
      message: `Invalid spend range: Minimum spend (${values.pinaka_loyalty_min_spend}) cannot be greater than Maximum spend (${values.pinaka_loyalty_max_spend}).`,
    };
  }
  if (values.pinaka_loyalty_min_points > values.pinaka_loyalty_max_points) {
    return {
      code: 'invalid_points_range',
      message: `Invalid points range: Minimum points (${values.pinaka_loyalty_min_points}) cannot be greater than Maximum points (${values.pinaka_loyalty_max_points}).`,
    };
  }
  const defaultPoints = nonNegativeInteger(body.pinaka_loyalty_default_points ?? 0);
  if (defaultPoints === undefined) return { code: 'invalid_integer_field', message: 'The field "pinaka_loyalty_default_points" must be an integer value.' };
  const loyaltyTag = String(body.pinaka_loyalty_tag || 'LoyaltyPoints').trim();
  if (!loyaltyTag) return { code: 'invalid_parameter', message: 'The field "pinaka_loyalty_tag" cannot be empty.' };
  const mode = body.pinaka_loyalty_mode === 'item' ? 'item' : body.pinaka_loyalty_mode === 'order' ? 'order' : undefined;
  if (!mode) return { code: 'invalid_parameter', message: 'The field "pinaka_loyalty_mode" must be order or item.' };
  const settings = settingsFromStored({ ...values, pinaka_loyalty_default_points: defaultPoints, pinaka_loyalty_tag: loyaltyTag, pinaka_loyalty_mode: mode, pinaka_loyalty_conflict_rule: conflict, pinaka_loyalty_allow_redemption: allowRedemption });
  return { settings };
}

export function isEmailContact(contact: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
}

export function loyaltyUsername(contact: string, email: boolean): string {
  if (email) {
    const local = contact.split('@')[0]?.toLowerCase() || 'customer';
    return `cust_${local}`;
  }
  const digits = contact.replace(/\D/g, '');
  return `cust_${digits || 'customer'}`;
}

export function loyaltyCustomerName(contact: string, email: boolean): string {
  if (email) return `Customer ${contact.split('@')[0] || 'customer'}`;
  return `Customer ${contact.slice(-4)}`;
}

export function closedOrderStatus(status: unknown): boolean {
  const value = String(status || '').trim().toLowerCase().replace(/^wc-/, '').replace(/_/g, '-');
  return value === 'completed' || value === 'cancelled' || value === 'canceled' || value === 'refunded';
}

export function integerValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

export function availableFromLedger(credited: number, redeemed: number, expired: number): number {
  return Math.max(0, credited - redeemed - expired);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function liveRedemption(input: {
  orderTotal: number;
  availablePoints: number;
  redeemPoint: number;
  redeemAmount: number;
  ebtEligibleTotal: number;
}): { redeemPoints: number; valueRedeemed: number; newPayable: number; message: string } {
  const orderTotal = roundMoney(input.orderTotal);
  const success = 'Loyalty customer processed successfully.';
  if (!(input.redeemPoint > 0) || !(input.redeemAmount > 0)) {
    return { redeemPoints: 0, valueRedeemed: 0, newPayable: orderTotal, message: success };
  }
  if (input.availablePoints < input.redeemPoint) {
    return {
      redeemPoints: 0,
      valueRedeemed: 0,
      newPayable: orderTotal,
      message: `User has no eligible loyalty points to redeem. eligible points should be at least ${roundMoney(input.redeemPoint)} to redeem.`,
    };
  }
  const amount = roundMoney(input.redeemAmount);
  if (orderTotal < amount) {
    return {
      redeemPoints: 0,
      valueRedeemed: 0,
      newPayable: orderTotal,
      message: `order total should be at least $${amount} to redeem points.`,
    };
  }
  if (input.ebtEligibleTotal > 0) {
    return {
      redeemPoints: 0,
      valueRedeemed: 0,
      newPayable: orderTotal,
      message: 'Loyalty points cannot be used on EBT-eligible Order.',
    };
  }
  return {
    redeemPoints: Math.trunc(input.redeemPoint),
    valueRedeemed: amount,
    newPayable: roundMoney(Math.max(0, orderTotal - amount)),
    message: success,
  };
}

export function welcomePoints(input: {
  availablePoints: number;
  alreadyAdded: unknown;
  configuredPoints: number;
  mode: LoyaltyMode;
  itemPoints: number;
}): number | undefined {
  if (!phpEmpty(input.alreadyAdded) || Number(input.availablePoints) !== 0) return undefined;
  const configured = Number(input.configuredPoints) || 0;
  return input.mode === 'item' ? configured + input.itemPoints : configured;
}

export function taggedItemPoints(lines: OrderLine[], products: CatalogProduct[]): number {
  let total = 0;
  for (const line of lines) {
    const productId = String(line.product_id ?? line.productId ?? '').trim();
    const variationId = String(line.variation_id ?? line.variationId ?? '').trim();
    const direct = products.find((product) => product.id === productId);
    const parent = direct?.parentId
      ? products.find((product) => product.id === direct.parentId) || direct
      : direct;
    if (!parent || !parent.tags.includes('loyaltypoints')) continue;
    const quantity = Number(line.quantity ?? 1);
    const useVariation = Boolean(variationId) && variationId !== '0';
    const variation = useVariation ? products.find((product) => product.id === variationId) : undefined;
    const points = useVariation || direct?.parentId
      ? Math.trunc(Number(variation?.points ?? direct?.points) || 0)
      : Math.trunc(Number(parent.points) || 0);
    total += points * (Number.isFinite(quantity) ? quantity : 0);
  }
  return total;
}

export function flattenCatalog(payload: unknown): CatalogProduct[] {
  const list = Array.isArray(payload) ? payload : [];
  const products: CatalogProduct[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const product = entry as Record<string, unknown>;
    products.push(catalogProduct(product));
    const variations = Array.isArray(product.variations) ? product.variations : [];
    for (const variation of variations) {
      if (!variation || typeof variation !== 'object') continue;
      products.push(catalogProduct(variation as Record<string, unknown>, String(product.id ?? '')));
    }
  }
  return products;
}

export function findNamedProduct(products: CatalogProduct[], name: string, ids: string[] = []): CatalogProduct | undefined {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return products.find((product) => wanted.has(product.id) || product.name.trim().toLowerCase() === name);
}

export function lineMatchesProduct(line: OrderLine, name: string, ids: string[]): boolean {
  const productId = String(line.product_id ?? line.productId ?? '').trim();
  const lineName = String(line.name || '').trim().toLowerCase();
  return lineName === name || ids.includes(productId);
}

export function redemptionBlocked(input: {
  conflictRule: string;
  discountTotal: number;
  couponCount: number;
  hasPayout: boolean;
  hasDiscountProduct: boolean;
  hasCashback: boolean;
}): boolean {
  if (input.conflictRule !== 'disable') return false;
  return input.discountTotal > 0 || input.couponCount > 0 || input.hasPayout || input.hasDiscountProduct || input.hasCashback;
}

export function partialRefundExpiredPoints(input: {
  mode: LoyaltyMode;
  creditedPoints: number[];
  refundTotal: number;
  ratioDollar: number | undefined;
  ratioPoint: number | undefined;
  availablePoints: number;
}): number {
  let expired = 0;
  if (input.mode === 'item') {
    expired = input.creditedPoints.reduce((sum, points) => sum + Math.trunc(Number(points) || 0), 0);
  } else if (input.refundTotal > 0) {
    const dollar = input.ratioDollar === undefined ? 10 : input.ratioDollar;
    const point = input.ratioPoint === undefined ? 1 : input.ratioPoint;
    if (dollar > 0 && point > 0) expired = Math.floor((input.refundTotal / dollar) * point);
  }
  const available = Math.max(0, Number(input.availablePoints) || 0);
  if (expired > available) expired = available;
  return Math.max(0, expired);
}

export function shouldClearLedgerAfterVoid(input: { voided: boolean; amountPaid: number; orderTotal: number }): boolean {
  return input.voided && input.amountPaid < input.orderTotal;
}

export function paymentIsVoid(payment: { is_void?: unknown; entry_type?: unknown; metadata?: unknown }): boolean {
  if (payment.is_void === true || payment.is_void === 't' || payment.is_void === 'true' || payment.is_void === 1 || payment.is_void === '1') {
    return true;
  }
  if (String(payment.entry_type || '').toLowerCase() === 'void') return true;
  const metadata = payment.metadata && typeof payment.metadata === 'object' ? payment.metadata as Record<string, unknown> : {};
  const source = metadata.source_payload && typeof metadata.source_payload === 'object'
    ? metadata.source_payload as Record<string, unknown>
    : {};
  const method = String(source.method || source.payment_method || '').trim().toLowerCase();
  return truthy(metadata.void) || truthy(metadata.is_void) || truthy(source.void) || truthy(source.is_void) || method === 'void';
}

export function lineMeta(line: OrderLine, key: string): unknown {
  const entries = [
    ...(Array.isArray(line.meta_data) ? line.meta_data : []),
    ...(Array.isArray(line.modifiers) ? line.modifiers : []),
  ];
  return entries.find((entry) => entry?.key === key)?.value;
}

export function withLineMeta(line: OrderLine, key: string, value: unknown): OrderLine {
  const entries = Array.isArray(line.meta_data) ? [...line.meta_data] : [];
  const index = entries.findIndex((entry) => entry?.key === key);
  if (index >= 0) entries[index] = { ...entries[index], key, value };
  else entries.push({ key, value });
  return { ...line, meta_data: entries, modifiers: entries };
}

export function publicOrderId(value: unknown, fallback?: unknown): number | string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  if (typeof fallback === 'number' && Number.isSafeInteger(fallback)) return fallback;
  if (typeof fallback === 'string' && /^\d+$/.test(fallback.trim())) return Number(fallback.trim());
  const digits = String(fallback ?? value ?? '').replace(/\D/g, '');
  if (digits && digits === String(fallback ?? '').replace(/^#/, '')) return Number(digits);
  return value === undefined || value === null || value === '' ? String(fallback ?? '') : value as string | number;
}

export function formatDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text.slice(0, 10);
}

function catalogProduct(product: Record<string, unknown>, parentId?: string): CatalogProduct {
  const tags = Array.isArray(product.tags) ? product.tags : [];
  return {
    id: String(product.id ?? ''),
    parentId: parentId || (product.parent_id != null && String(product.parent_id) !== '0' ? String(product.parent_id) : undefined),
    name: String(product.name || ''),
    tags: tags.map((tag) => typeof tag === 'string'
      ? tag.trim().toLowerCase()
      : String((tag as { slug?: unknown; name?: unknown })?.slug || (tag as { name?: unknown })?.name || '').trim().toLowerCase(),
    ).filter(Boolean),
    points: metaNumber(product, '_product_loyalty_points'),
  };
}

function metaNumber(product: Record<string, unknown>, key: string): number {
  const meta = Array.isArray(product.meta_data) ? product.meta_data : [];
  const found = meta.find((entry) => entry && typeof entry === 'object' && (entry as { key?: unknown }).key === key) as { value?: unknown } | undefined;
  const raw = found ? found.value : product[key];
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes') return true;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no') return false;
  return undefined;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return booleanValue(value) ?? fallback;
}

function idList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return [];
  return [String(value).trim()].filter(Boolean);
}

function phpEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === 0 || value === '0' || value === false;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'yes';
}
