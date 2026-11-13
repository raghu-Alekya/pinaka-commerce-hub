import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MerchantRepository } from '../merchant/merchant.repository';
import {
  ConsoleGrant,
  actionForMethod,
  allows,
  collectMerchantIds,
  collectStoreIds,
  grantsFromKeys,
  intersectGrants,
  isPlatformMasterPath,
  isProfilePath,
  merchantGrants,
  moduleForPath,
  requestPath,
  sameMerchant,
} from './console-access';

type ConsoleUser = {
  id?: string;
  email?: string;
  role?: string;
  accountType?: string;
  merchantId?: string;
  merchantCode?: string;
  employeeId?: string;
  roleId?: string;
  roleName?: string;
};

type AccessRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  user?: ConsoleUser;
};

@Injectable()
export class ConsoleAccessService {
  private ready: Promise<void> | null = null;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  merchantGrantList(): ConsoleGrant[] {
    return merchantGrants();
  }

  async assert(request: AccessRequest): Promise<void> {
    const user = request.user;
    if (!user || (user.accountType !== 'merchant' && user.accountType !== 'employee')) return;
    if (!user.merchantId) throw new UnauthorizedException('Merchant context is missing from the session');

    const merchant = await this.merchantRow(user.merchantId);
    if (!merchant || merchant.status !== 'ACTIVE') {
      throw new UnauthorizedException('Merchant account is inactive');
    }
    user.merchantCode = merchant.code;

    const path = requestPath(request);
    const scoped = { ...request, path };
    if (isPlatformMasterPath(path)) {
      throw new ForbiddenException('This account cannot access platform administration');
    }
    const merchantIds = collectMerchantIds(scoped);
    if (merchantIds.some((value) => !sameMerchant(value, merchant.id, merchant.code))) {
      throw new ForbiddenException('You can only access your own merchant records');
    }

    if (user.accountType === 'employee') {
      if (!user.employeeId) throw new UnauthorizedException('Employee context is missing from the session');
      const employee = await this.employeeRow(user.employeeId, merchant.id);
      if (!employee || employee.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is inactive');
      }
    }

    const storeIds = collectStoreIds(scoped);
    for (const storeId of storeIds) {
      const store = await this.ownedStore(merchant.id, storeId);
      if (!store) throw new ForbiddenException('That store does not belong to this merchant');
      if (user.accountType === 'employee' && !(await this.employeeStore(user.employeeId!, store.id))) {
        throw new ForbiddenException('You are not assigned to this store');
      }
    }

    if (user.accountType === 'employee' && !isProfilePath(path)) {
      const module = moduleForPath(path);
      if (!module) throw new ForbiddenException('You do not have access to this module');
      const grants = await this.employeeGrants(user.employeeId!, merchant.id);
      if (!allows(grants, module, actionForMethod(request.method))) {
        throw new ForbiddenException(`You do not have ${actionForMethod(request.method)} access to ${module}`);
      }
    }
  }

  async employeeGrants(employeeId: string, merchantId: string): Promise<ConsoleGrant[]> {
    await this.ensureTable();
    const rows = await this.merchants.requireDataSource().query(
      `SELECT p.menu_key
         FROM public.console_menu_permissions p
        WHERE p.principal_role = 'MERCHANT_EMPLOYEE'
          AND p.allowed = true
          AND p.role_template_id IN (
            SELECT esr.role_id
              FROM public.employee_stores es
              JOIN public.employee_store_roles esr ON esr.employee_store_id = es.id
              JOIN public.roles r ON r.id = esr.role_id
             WHERE es.employee_id = $1
               AND es.merchant_id = $2
               AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
               AND UPPER(COALESCE(esr.status::text, 'ACTIVE')) = 'ACTIVE'
               AND UPPER(COALESCE(r.status::text, 'ACTIVE')) = 'ACTIVE'
          )`,
      [employeeId, merchantId],
    ) as { menu_key: string }[];
    return grantsFromKeys(rows.map((row) => row.menu_key));
  }

  async filterGrantsForActor(user: ConsoleUser | undefined, grants: ConsoleGrant[]): Promise<ConsoleGrant[]> {
    if (user?.accountType !== 'employee' || !user.employeeId || !user.merchantId) return grants || [];
    const held = await this.employeeGrants(user.employeeId, user.merchantId);
    return intersectGrants(grants, held);
  }

  async profile(user: ConsoleUser) {
    if (!user.merchantId) throw new UnauthorizedException('Merchant context is missing from the session');
    const merchant = await this.merchantRow(user.merchantId);
    if (!merchant || merchant.status !== 'ACTIVE') throw new UnauthorizedException('Merchant account is inactive');
    const stores = await this.storesFor(user, merchant.id);
    if (user.accountType === 'employee') {
      if (!user.employeeId) throw new UnauthorizedException('Employee context is missing from the session');
      const employee = await this.employeeRow(user.employeeId, merchant.id);
      if (!employee || employee.status !== 'ACTIVE') throw new UnauthorizedException('Employee account is inactive');
      const permissions = await this.employeeGrants(employee.id, merchant.id);
      const role = await this.employeeRole(employee.id, merchant.id);
      return {
        success: true,
        user: {
          id: employee.id,
          email: employee.email,
          firstName: employee.firstName,
          lastName: employee.lastName,
          role: role?.name || 'Employee',
          accountType: 'employee',
          merchantId: merchant.id,
          merchantCode: merchant.code,
          employeeId: employee.id,
          roleId: role?.id || null,
          permissions,
          stores,
        },
        permissions,
        stores,
      };
    }
    const permissions = merchantGrants();
    return {
      success: true,
      user: {
        id: user.id || merchant.id,
        email: user.email || merchant.email,
        firstName: merchant.firstName,
        lastName: merchant.lastName,
        businessDisplayName: merchant.businessName,
        role: 'Merchant',
        accountType: 'merchant',
        merchantId: merchant.id,
        merchantCode: merchant.code,
        permissions,
        stores,
      },
      permissions,
      stores,
    };
  }

  async assignEmployeeRole(merchantId: string, employeeId: string, roleId: string, storeId: string | undefined, actor: ConsoleUser | undefined) {
    if (actor?.accountType === 'employee' && actor.employeeId === employeeId) {
      throw new ForbiddenException('Employees cannot change their own role');
    }
    const merchant = await this.merchantRow(merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const db = this.merchants.requireDataSource();
    const roles = await db.query(
      `SELECT id FROM public.roles
        WHERE id = $1::uuid
          AND (merchant_id = $2 OR merchant_id = $3)
          AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'
        LIMIT 1`,
      [roleId, merchant.id, merchant.code],
    );
    if (!roles.length) throw new NotFoundException('Role not found for this merchant');
    const employee = await this.employeeRow(employeeId, merchant.id);
    if (!employee) throw new NotFoundException('Employee not found for this merchant');
    const assignments = await db.query(
      `SELECT id, store_id AS "storeId", merchant_id AS "merchantId"
         FROM public.employee_stores
        WHERE employee_id = $1
          AND merchant_id = $2
          AND ($3::uuid IS NULL OR store_id = $3::uuid)
          AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'`,
      [employeeId, merchant.id, storeId || null],
    );
    if (!assignments.length) throw new NotFoundException('Assign the employee to a store before choosing a role');
    for (const assignment of assignments) {
      await db.query(
        `UPDATE public.employee_store_roles
            SET status = 'INACTIVE', updated_at = now()
          WHERE employee_store_id = $1
            AND role_id <> $2
            AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'`,
        [assignment.id, roleId],
      );
      await db.query(
        `INSERT INTO public.employee_store_roles
           (merchant_id, store_id, employee_store_id, role_id, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (employee_store_id, role_id)
         DO UPDATE SET status = 'ACTIVE', updated_at = now()`,
        [assignment.merchantId, assignment.storeId, assignment.id, roleId],
      );
    }
    return { success: true, message: 'Employee role updated', employeeId, roleId, count: assignments.length };
  }

  async listAccessEmployees(merchantId: string) {
    const merchant = await this.merchantRow(merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const rows = await this.merchants.requireDataSource().query(
      `SELECT e.id,
              e.first_name AS "firstName",
              e.last_name AS "lastName",
              e.email,
              e.status::text AS status,
              es.store_id AS "storeId",
              s.store_name AS "storeName",
              r.id AS "roleId",
              r.name AS "roleName"
         FROM public.employees e
         LEFT JOIN public.employee_stores es
           ON es.employee_id = e.id
          AND es.merchant_id = e.merchant_id
          AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
         LEFT JOIN public.stores s ON s.id = es.store_id
         LEFT JOIN public.employee_store_roles esr
           ON esr.employee_store_id = es.id
          AND UPPER(COALESCE(esr.status::text, 'ACTIVE')) = 'ACTIVE'
         LEFT JOIN public.roles r ON r.id = esr.role_id
        WHERE e.merchant_id = $1
          AND COALESCE(e.is_deleted, false) = false
        ORDER BY e.first_name, e.last_name, s.store_name`,
      [merchant.id],
    );
    return { success: true, count: rows.length, employees: rows };
  }

  private async merchantRow(merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id,
              merchant_code AS code,
              email,
              first_name AS "firstName",
              last_name AS "lastName",
              business_display_name AS "businessName",
              status::text AS status
         FROM public.merchants
        WHERE COALESCE(is_deleted, false) = false
          AND (id::text = $1 OR lower(merchant_code) = lower($1))
        ORDER BY CASE WHEN id::text = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [merchantId],
    );
    return rows[0] as {
      id: string; code: string; email: string; firstName: string; lastName: string; businessName: string; status: string;
    } | undefined;
  }

  private async employeeRow(employeeId: string, merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id, email, first_name AS "firstName", last_name AS "lastName", status::text AS status
         FROM public.employees
        WHERE id = $1::uuid AND merchant_id = $2::uuid
        LIMIT 1`,
      [employeeId, merchantId],
    );
    return rows[0] as { id: string; email: string; firstName: string; lastName: string; status: string } | undefined;
  }

  private async employeeRole(employeeId: string, merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT r.id::text AS id, r.name
         FROM public.employee_stores es
         JOIN public.employee_store_roles esr ON esr.employee_store_id = es.id
         JOIN public.roles r ON r.id = esr.role_id
        WHERE es.employee_id = $1
          AND es.merchant_id = $2
          AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(esr.status::text, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(r.status::text, 'ACTIVE')) = 'ACTIVE'
        ORDER BY es.is_primary DESC NULLS LAST, r.name
        LIMIT 1`,
      [employeeId, merchantId],
    );
    return rows[0] as { id: string; name: string } | undefined;
  }

  private async storesFor(user: ConsoleUser, merchantId: string) {
    if (user.accountType === 'employee' && user.employeeId) {
      return this.merchants.requireDataSource().query(
        `SELECT s.id, s.store_code AS "storeCode", s.store_name AS "storeName", s.status::text AS status
           FROM public.employee_stores es
           JOIN public.stores s ON s.id = es.store_id
          WHERE es.employee_id = $1
            AND es.merchant_id = $2
            AND COALESCE(s.is_deleted, false) = false
            AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
          ORDER BY s.store_name`,
        [user.employeeId, merchantId],
      );
    }
    return this.merchants.requireDataSource().query(
      `SELECT id, store_code AS "storeCode", store_name AS "storeName", status::text AS status
         FROM public.stores
        WHERE merchant_id = $1::uuid AND COALESCE(is_deleted, false) = false
        ORDER BY store_name, id`,
      [merchantId],
    );
  }

  private async ownedStore(merchantId: string, storeToken: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id
         FROM public.stores
        WHERE merchant_id = $1::uuid
          AND COALESCE(is_deleted, false) = false
          AND (id::text = $2 OR lower(store_code) = lower($2))
        LIMIT 1`,
      [merchantId, storeToken],
    );
    return rows[0] as { id: string } | undefined;
  }

  private async employeeStore(employeeId: string, storeId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT 1
         FROM public.employee_stores
        WHERE employee_id = $1
          AND store_id = $2::uuid
          AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'
        LIMIT 1`,
      [employeeId, storeId],
    );
    return Boolean(rows.length);
  }

  private ensureTable() {
    if (!this.ready) {
      this.ready = this.merchants.requireDataSource().query(`
        CREATE TABLE IF NOT EXISTS public.console_menu_permissions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          principal_role varchar(40) NOT NULL,
          role_template_id uuid NULL,
          menu_key varchar(80) NOT NULL,
          allowed boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `).then(() => undefined).catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }
}
