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

    const stored = rows
      .map((row) => row.menu_key)
      .filter((key) => MENU_KEY_SET.has(key));

    return {
      success: true,
      principalRole: scope.principalRole,
      roleTemplateId: scope.roleTemplateId,
      configured: stored.length > 0,
      menuKeys: stored.length > 0 ? this.normalize(scope.principalRole, stored) : this.defaults(scope.principalRole),
    };
  }

  async save(body: {
    principalRole?: string;
    roleTemplateId?: string | null;
    menuKeys?: string[];
  }) {
    const scope = this.scope(body?.principalRole, body?.roleTemplateId || undefined);
    const menuKeys = this.normalize(scope.principalRole, body?.menuKeys || []);
    await this.ensureTable();

    const dataSource = this.merchants.requireDataSource();
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM public.console_menu_permissions
          WHERE principal_role = $1
            AND role_template_id IS NOT DISTINCT FROM $2::uuid`,
        [scope.principalRole, scope.roleTemplateId],
      );

      for (const menuKey of menuKeys) {
        await manager.query(
          `INSERT INTO public.console_menu_permissions
             (principal_role, role_template_id, menu_key, allowed)
           VALUES ($1, $2, $3, true)`,
          [scope.principalRole, scope.roleTemplateId, menuKey],
        );
      }
    });

    return {
      success: true,
      message: 'Menu permissions saved',
      principalRole: scope.principalRole,
      roleTemplateId: scope.roleTemplateId,
      configured: true,
      menuKeys,
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

  private defaults(principalRole: string) {
    if (principalRole === 'MERCHANT') return [...MERCHANT_DEFAULTS];
    if (principalRole === 'MERCHANT_EMPLOYEE') return ['dashboard'];
    return [...MENU_KEYS];
  }

  private normalize(principalRole: string, menuKeys: string[]) {
    if (principalRole === 'SUPER_ADMIN') return [...MENU_KEYS];
    const selected = menuKeys.filter((key) => MENU_KEY_SET.has(String(key)));
    if (!selected.includes('dashboard')) selected.unshift('dashboard');
    return [...new Set(selected)];
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
