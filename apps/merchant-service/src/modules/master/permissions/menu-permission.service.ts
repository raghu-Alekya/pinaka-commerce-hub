import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';

const MENU_KEYS = [
  'dashboard',
  'merchants',
  'stores',
  'subscriptions',
  'vendors',
  'store-types',
  'features',
  'feature-permissions',
  'role-templates',
  'plans',
  'tenders',
  'menu-permissions',
  'pos-configuration',
  'orders',
  'cash-management',
  'employees',
  'devices',
  'shifts',
  'attendance',
  'integrations',
  'synchronization',
  'reconciliation',
  'notifications',
] as const;

const MENU_KEY_SET = new Set<string>(MENU_KEYS);
const ACTIONS = ['view', 'create', 'update', 'delete'] as const;
const CRUD_KEYS = new Set([
  'merchants',
  'stores',
  'subscriptions',
  'vendors',
  'store-types',
  'features',
  'feature-permissions',
  'role-templates',
  'plans',
  'tenders',
  'employees',
  'devices',
  'pos-configuration',
]);

const PLATFORM_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MERCHANT']);

const MERCHANT_DEFAULTS = [
  'dashboard',
  'stores',
  'subscriptions',
  'pos-configuration',
  'orders',
  'cash-management',
  'employees',
  'devices',
  'shifts',
  'attendance',
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MenuRow = { menu_key: string };
type Grant = { menuKey: string; actions: string[] };

@Injectable()
export class MenuPermissionService {
  private ready: Promise<void> | null = null;

  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
  ) {}

  async get(principalRole?: string, roleTemplateId?: string) {
    const scope = this.scope(principalRole, roleTemplateId);
    await this.ensureTable();
    const rows = await this.merchants.requireDataSource().query(
      `SELECT menu_key
         FROM public.console_menu_permissions
        WHERE principal_role = $1
          AND role_template_id IS NOT DISTINCT FROM $2::uuid
          AND allowed = true
        ORDER BY menu_key`,
      [scope.principalRole, scope.roleTemplateId],
    ) as MenuRow[];

    const grants = scope.principalRole === 'SUPER_ADMIN'
      ? this.defaultGrants('SUPER_ADMIN')
      : rows.length
        ? this.grantsFromStored(rows.map((row) => row.menu_key))
        : this.defaultGrants(scope.principalRole);

    return {
      success: true,
      principalRole: scope.principalRole,
      roleTemplateId: scope.roleTemplateId,
      configured: rows.length > 0,
      grants,
      menuKeys: grants.filter((grant) => grant.actions.includes('view')).map((grant) => grant.menuKey),
    };
  }

  async save(body: {
    principalRole?: string;
    roleTemplateId?: string | null;
    menuKeys?: string[];
    grants?: Grant[];
  }) {
    const scope = this.scope(body?.principalRole, body?.roleTemplateId || undefined);
    const grants = this.normalizeGrants(
      scope.principalRole,
      Array.isArray(body?.grants)
        ? body.grants
        : (body?.menuKeys || []).map((menuKey) => ({
            menuKey,
            actions: this.actionsFor(menuKey),
          })),
    );
    await this.ensureTable();

    const dataSource = this.merchants.requireDataSource();
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM public.console_menu_permissions
          WHERE principal_role = $1
            AND role_template_id IS NOT DISTINCT FROM $2::uuid`,
        [scope.principalRole, scope.roleTemplateId],
      );

      for (const grant of grants) {
        for (const action of grant.actions) {
          await manager.query(
            `INSERT INTO public.console_menu_permissions
               (principal_role, role_template_id, menu_key, allowed)
             VALUES ($1, $2, $3, true)`,
            [scope.principalRole, scope.roleTemplateId, `${grant.menuKey}.${action}`],
          );
        }
      }
    });

    return {
      success: true,
      message: 'Menu permissions saved',
      principalRole: scope.principalRole,
      roleTemplateId: scope.roleTemplateId,
      configured: true,
      grants,
      menuKeys: grants.filter((grant) => grant.actions.includes('view')).map((grant) => grant.menuKey),
    };
  }

  private scope(principalRole?: string, roleTemplateId?: string) {
    const role = String(principalRole || '').trim().toUpperCase();
    if (!PLATFORM_ROLES.has(role) && role !== 'MERCHANT_EMPLOYEE') {
      throw new BadRequestException(
        'principalRole must be SUPER_ADMIN, ADMIN, MERCHANT, or MERCHANT_EMPLOYEE',
      );
    }

    if (role === 'MERCHANT_EMPLOYEE') {
      const templateId = String(roleTemplateId || '').trim();
      if (!UUID_PATTERN.test(templateId)) {
        throw new BadRequestException('roleTemplateId must be a UUID for a merchant employee role');
      }
      return { principalRole: role, roleTemplateId: templateId };
    }

    return { principalRole: role, roleTemplateId: null };
  }

  private actionsFor(menuKey: string) {
    if (CRUD_KEYS.has(menuKey)) return [...ACTIONS];
    return ['view'];
  }

  private defaultMenuKeys(principalRole: string) {
    if (principalRole === 'MERCHANT') return [...MERCHANT_DEFAULTS];
    if (principalRole === 'MERCHANT_EMPLOYEE') return ['dashboard'];
    return [...MENU_KEYS];
  }

  private defaultGrants(principalRole: string): Grant[] {
    return this.defaultMenuKeys(principalRole).map((menuKey) => ({
      menuKey,
      actions: this.actionsFor(menuKey),
    }));
  }

  private grantsFromStored(keys: string[]): Grant[] {
    const byMenu = new Map<string, Set<string>>();
    for (const raw of keys) {
      const value = String(raw || '');
      const dot = value.lastIndexOf('.');
      const menuKey = dot > 0 ? value.slice(0, dot) : value;
      const action = dot > 0 ? value.slice(dot + 1) : '';
      if (!MENU_KEY_SET.has(menuKey)) continue;
      const known = this.actionsFor(menuKey);
      const actions = action && known.includes(action) ? [action] : known;
      const current = byMenu.get(menuKey) || new Set<string>();
      actions.forEach((item) => current.add(item));
      byMenu.set(menuKey, current);
    }
    return this.normalizeGrants(
      'ADMIN',
      [...byMenu.entries()].map(([menuKey, actions]) => ({
        menuKey,
        actions: [...actions],
      })),
    );
  }

  private normalizeGrants(principalRole: string, grants: Grant[]): Grant[] {
    if (principalRole === 'SUPER_ADMIN') return this.defaultGrants('SUPER_ADMIN');
    const byMenu = new Map<string, string[]>();
    for (const grant of grants || []) {
      const menuKey = String(grant?.menuKey || '');
      if (!MENU_KEY_SET.has(menuKey)) continue;
      const known = this.actionsFor(menuKey);
      const actions = [...new Set((grant.actions || []).filter((action) => known.includes(action)))];
      if (actions.some((action) => action !== 'view') && !actions.includes('view')) {
        actions.unshift('view');
      }
      if (actions.length) byMenu.set(menuKey, actions);
    }
    if (!byMenu.has('dashboard')) byMenu.set('dashboard', ['view']);
    return [...byMenu.entries()].map(([menuKey, actions]) => ({ menuKey, actions }));
  }

  private ensureTable() {
    if (!this.ready) {
      this.ready = this.createTable().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  private async createTable() {
    const dataSource = this.merchants.requireDataSource();
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.console_menu_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        principal_role varchar(40) NOT NULL,
        role_template_id uuid NULL,
        menu_key varchar(80) NOT NULL,
        allowed boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS console_menu_permissions_role_key_uidx
        ON public.console_menu_permissions (
          principal_role,
          (COALESCE(role_template_id, '00000000-0000-0000-0000-000000000000'::uuid)),
          menu_key
        )
    `);
  }
}
