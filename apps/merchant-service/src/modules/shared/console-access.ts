export const CONSOLE_ACTIONS = ['view', 'create', 'update', 'delete'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

export type ConsoleGrant = { menuKey: string; actions: string[] };

/** Modules a merchant administers. Platform master-data stays off this list. */
export const MERCHANT_MODULES = [
  'dashboard',
  'stores',
  'products',
  'discounts',
  'coupons',
  'employees',
  'customers',
  'vendors',
  'fastkeys',
  'orders',
  'payments',
  'vendor-payments',
  'safe-drops',
  'pos-configuration',
  'shifts',
  'attendance',
  'devices',
  'subscriptions',
  'cash-management',
  'access-permissions',
] as const;

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  stores: 'Stores',
  products: 'Products',
  discounts: 'Discounts',
  coupons: 'Coupons',
  employees: 'Employees',
  customers: 'Customers',
  vendors: 'Vendors',
  fastkeys: 'Fastkeys',
  orders: 'Orders',
  payments: 'Payments',
  'vendor-payments': 'Vendor Payments',
  'safe-drops': 'Safe Drops',
  'pos-configuration': 'POS Configurations',
  shifts: 'Shifts',
  attendance: 'Attendance',
  devices: 'Devices',
  subscriptions: 'Subscriptions',
  'cash-management': 'Cash Management',
  'access-permissions': 'Access & Permissions',
};

const VIEW_ONLY = new Set(['dashboard']);
const RESERVED_MERCHANT_SEGMENTS = new Set(['employees', 'create-merchant']);
const RESERVED_STORE_SEGMENTS = new Set([
  'bulk',
  'employees',
  'role-permissions',
  'assignment-screen',
  'pos',
  'new',
]);

const MODULE_RULES: { pattern: RegExp; module: string }[] = [
  { pattern: /\/roles(\/|$)/i, module: 'access-permissions' },
  { pattern: /menu-permissions|access-permissions|\/access(\/|$)/i, module: 'access-permissions' },
  { pattern: /vendor-payments|vendor_payments|store-vendor-payments/i, module: 'vendor-payments' },
  { pattern: /safe-drop/i, module: 'safe-drops' },
  { pattern: /fastkey/i, module: 'fastkeys' },
  { pattern: /pos-configuration|store-pos-configuration|\/pos\//i, module: 'pos-configuration' },
  { pattern: /\/discounts(\/|$)/i, module: 'discounts' },
  { pattern: /\/coupons(\/|$)/i, module: 'coupons' },
  { pattern: /\/products(\/|$)|\/catalog(\/|$)/i, module: 'products' },
  { pattern: /\/customers(\/|$)/i, module: 'customers' },
  { pattern: /\/vendors(\/|$)/i, module: 'vendors' },
  { pattern: /\/orders(\/|$)/i, module: 'orders' },
  { pattern: /\/payments(\/|$)/i, module: 'payments' },
  { pattern: /\/shifts(\/|$)/i, module: 'shifts' },
  { pattern: /attendance/i, module: 'attendance' },
  { pattern: /\/employees(\/|$)/i, module: 'employees' },
  { pattern: /\/devices(\/|$)/i, module: 'devices' },
  { pattern: /\/stores(\/|$)/i, module: 'stores' },
  { pattern: /\/subscriptions(\/|$)/i, module: 'subscriptions' },
  { pattern: /cash-management|cash_management/i, module: 'cash-management' },
];

export function merchantGrants(): ConsoleGrant[] {
  return MERCHANT_MODULES.map((menuKey) => ({
    menuKey,
    actions: VIEW_ONLY.has(menuKey) ? ['view'] : [...CONSOLE_ACTIONS],
  }));
}

export function moduleCatalog() {
  return MERCHANT_MODULES.map((menuKey) => ({
    menuKey,
    label: MODULE_LABELS[menuKey] || menuKey,
    actions: VIEW_ONLY.has(menuKey) ? ['view'] : [...CONSOLE_ACTIONS],
  }));
}

export function actionForMethod(method?: string): ConsoleAction {
  const name = String(method || 'GET').toUpperCase();
  if (name === 'POST') return 'create';
  if (name === 'PUT' || name === 'PATCH') return 'update';
  if (name === 'DELETE') return 'delete';
  return 'view';
}

export function requestPath(request: { originalUrl?: string; url?: string; path?: string }): string {
  return String(request.originalUrl || request.url || request.path || '').split('?')[0];
}

export function isProfilePath(path: string): boolean {
  return /\/console\/(me|logout)\/?$/i.test(path);
}

export function isMerchantDirectory(path: string): boolean {
  return /\/merchants\/?$/i.test(path);
}

export function isPlatformMasterPath(path: string): boolean {
  if (/\/merchants\/[^/]+/i.test(path)) return false;
  return /\/(store-types|features|feature-permissions|role-templates|plans|permissions|tenders)(\/|$)/i.test(path);
}

export function moduleForPath(path: string): string | null {
  if (/\/pos\/auth(\/|$)/i.test(path) || /\/auth\/(console|login|merchant-login|employee-console-login)(\/|$)/i.test(path)) {
    return null;
  }
  const match = MODULE_RULES.find((rule) => rule.pattern.test(path));
  return match?.module || null;
}

export function allows(grants: ConsoleGrant[] | undefined, module: string, action: string): boolean {
  const grant = (grants || []).find((item) => item.menuKey === module);
  return Boolean(grant?.actions?.includes(action));
}

export function grantsFromKeys(keys: string[]): ConsoleGrant[] {
  const byMenu = new Map<string, Set<string>>();
  for (const raw of keys) {
    const value = String(raw || '');
    const dot = value.lastIndexOf('.');
    const menuKey = dot > 0 ? value.slice(0, dot) : value;
    const action = dot > 0 ? value.slice(dot + 1) : 'view';
    if (!MERCHANT_MODULES.includes(menuKey as (typeof MERCHANT_MODULES)[number])) continue;
    const allowed = VIEW_ONLY.has(menuKey) ? ['view'] : [...CONSOLE_ACTIONS];
    if (!allowed.includes(action as ConsoleAction)) continue;
    const current = byMenu.get(menuKey) || new Set<string>();
    current.add(action);
    byMenu.set(menuKey, current);
  }
  if (!byMenu.has('dashboard')) byMenu.set('dashboard', new Set(['view']));
  return [...byMenu.entries()].map(([menuKey, actions]) => ({ menuKey, actions: [...actions] }));
}

export function sameMerchant(value: string, merchantId: string, merchantCode?: string | null): boolean {
  const token = String(value || '').trim();
  if (!token) return true;
  if (token === merchantId) return true;
  return Boolean(merchantCode && token.toLowerCase() === merchantCode.toLowerCase());
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return '';
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  return typeof value === 'string' ? value.trim() : '';
}

function pushId(target: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) target.push(value.trim());
}

export function collectMerchantIds(request: {
  path: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
}): string[] {
  const ids: string[] = [];
  pushId(ids, request.params?.merchantId);
  pushId(ids, request.params?.merchant_id);
  pushId(ids, request.query?.merchantId);
  pushId(ids, request.query?.merchant_id);
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : undefined;
  pushId(ids, body?.merchantId);
  pushId(ids, body?.merchant_id);
  pushId(ids, headerValue(request.headers, 'x-merchant-id'));
  const segment = request.path.match(/\/merchants\/([^/]+)/i)?.[1];
  if (segment && !RESERVED_MERCHANT_SEGMENTS.has(decodeURIComponent(segment).toLowerCase())) {
    pushId(ids, decodeURIComponent(segment));
  }
  return [...new Set(ids)];
}

export function collectStoreIds(request: {
  path: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
}): string[] {
  const ids: string[] = [];
  pushId(ids, request.params?.storeId);
  pushId(ids, request.params?.store_id);
  pushId(ids, request.query?.storeId);
  pushId(ids, request.query?.store_id);
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : undefined;
  pushId(ids, body?.storeId);
  pushId(ids, body?.store_id);
  pushId(ids, headerValue(request.headers, 'x-store-id'));
  const segment = request.path.match(/\/stores\/([^/]+)/i)?.[1];
  if (segment && !RESERVED_STORE_SEGMENTS.has(decodeURIComponent(segment).toLowerCase())) {
    pushId(ids, decodeURIComponent(segment));
  }
  return [...new Set(ids)];
}

export function intersectGrants(requested: ConsoleGrant[] | undefined, held: ConsoleGrant[]): ConsoleGrant[] {
  return (requested || []).map((grant) => ({
    menuKey: grant.menuKey,
    actions: (grant.actions || []).filter((action) => allows(held, grant.menuKey, action)),
  })).filter((grant) => grant.actions.length);
}
