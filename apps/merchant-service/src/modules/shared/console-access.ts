export const CONSOLE_ACTIONS = ['view', 'create', 'update', 'delete'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];
export type ConsoleGrant = { menuKey: string; actions: string[] };

/** Modules a merchant console account can administer. Platform master data is not included. */
export const MERCHANT_MODULES = [
  'dashboard',
  'merchants',
  'stores',
  'subscriptions',
  'pos-configuration',
  'orders',
  'cash-management',
  'employees',
  'devices',
  'shifts',
  'attendance',
  'products',
  'discounts',
  'coupons',
  'customers',
  'vendors',
  'fastkeys',
  'payments',
  'vendor-payments',
  'safe-drops',
  'access-permissions',
] as const;

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  merchants: 'Merchants',
  stores: 'Stores',
  subscriptions: 'Subscriptions',
  'pos-configuration': 'POS Configurations',
  orders: 'Orders',
  'cash-management': 'Cash Management',
  employees: 'Employees',
  devices: 'Devices',
  shifts: 'Shifts',
  attendance: 'Attendance',
  products: 'Products',
  discounts: 'Discounts',
  coupons: 'Coupons',
  customers: 'Customers',
  vendors: 'Vendors',
  fastkeys: 'Fastkeys',
  payments: 'Payments',
  'vendor-payments': 'Vendor Payments',
  'safe-drops': 'Safe Drops',
  'access-permissions': 'Access & Permissions',
};

const VIEW_ONLY = new Set(['dashboard', 'merchants']);
const RESERVED_MERCHANT_SEGMENTS = new Set(['employees', 'create-merchant']);

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
  { pattern: /\/merchants(\/|$)/i, module: 'merchants' },
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

export function isWebConsoleRequest(request?: { headers?: Record<string, string | undefined> }): boolean {
  return request?.headers?.['x-pch-web-console'] === '1';
}

export function isProfilePath(path: string): boolean {
  return /\/console\/(me|logout)\/?$/i.test(path);
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
  if (!token || RESERVED_MERCHANT_SEGMENTS.has(token)) return true;
  const id = String(merchantId || '').trim();
  const code = String(merchantCode || '').trim();
  return token === id || token.toLowerCase() === code.toLowerCase();
}

export function merchantSegment(path: string): string | null {
  const match = path.match(/\/merchants\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export function storeSegment(path: string): string | null {
  const match = path.match(/\/stores\/([^/]+)/i);
  if (!match) return null;
  const segment = decodeURIComponent(match[1]);
  if (['bulk', 'employees', 'role-permissions', 'assignment-screen', 'pos', 'new'].includes(segment)) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ? segment : null;
}

export function filterGrantsForActor(grants: ConsoleGrant[], actorGrants: ConsoleGrant[]): ConsoleGrant[] {
  return grants.map((grant) => {
    const allowed = new Set(actorGrants.find((item) => item.menuKey === grant.menuKey)?.actions || []);
    return { menuKey: grant.menuKey, actions: grant.actions.filter((action) => allowed.has(action)) };
  }).filter((grant) => grant.actions.length);
}
