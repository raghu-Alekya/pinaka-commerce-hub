import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MerchantRepository } from '../merchant/merchant.repository';
import {
  actionForMethod,
  allows,
  filterGrantsForActor,
  grantsFromKeys,
  isPlatformMasterPath,
  isProfilePath,
  merchantGrants,
  merchantSegment,
  moduleCatalog,
  moduleForPath,
  requestPath,
  sameMerchant,
  storeSegment,
  type ConsoleGrant,
} from './console-access';

type ConsoleUser = {
  accountType?: string;
  merchantId?: string;
  merchantCode?: string;
  employeeId?: string;
  id?: string;
  email?: string;
};

type ConsoleRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  user?: ConsoleUser;
};

@Injectable()
export class ConsoleAccessService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async assert(request: ConsoleRequest): Promise<void> {
    const user = request.user;
    if (user?.accountType !== 'merchant' && user?.accountType !== 'employee') return;
    const path = requestPath(request);
    if (isProfilePath(path)) return;
    if (isPlatformMasterPath(path)) {
      throw new ForbiddenException('This account cannot access platform administration');
    }
    const merchantId = String(user.merchantId || '');
    const segment = merchantSegment(path);
    if (segment && !sameMerchant(segment, merchantId, user.merchantCode)) {
      throw new ForbiddenException('You can only access your own merchant records');
    }
    const storeId = storeSegment(path);
    if (storeId) await this.assertStoreMerchant(storeId, merchantId);
    const moduleName = moduleForPath(path);
    if (!moduleName) {
      if (user.accountType === 'employee') {
        throw new ForbiddenException('You do not have permission for this action');
      }
      return;
    }
    const grants = user.accountType === 'merchant'
      ? merchantGrants()
      : await this.employeeGrants(String(user.employeeId || user.id || ''), merchantId);
    if (!allows(grants, moduleName, actionForMethod(request.method))) {
      throw new ForbiddenException('You do not have permission for this action');
    }
  }

  async employeeGrants(employeeId: string, merchantId: string): Promise<ConsoleGrant[]> {
    const merchant = await this.merchantRow(merchantId);
    if (!merchant || merchant.status !== 'ACTIVE') throw new UnauthorizedException('Merchant account is inactive');
    const employee = await this.employeeRow(employeeId, merchant.id);
    if (!employee || String(employee.status || '').toUpperCase() !== 'ACTIVE') {
      throw new UnauthorizedException('Employee account is inactive');
    }
    const db = this.merchants.requireDataSource();
    const keys = await db.query(
      `SELECT p.menu_key AS "menuKey"
         FROM public.employee_stores es
         JOIN public.employee_store_roles esr ON esr.employee_store_id = es.id
         JOIN public.console_menu_permissions p
           ON p.role_template_id = esr.role_id
          AND p.principal_role = 'MERCHANT_EMPLOYEE'
          AND p.allowed = true
        WHERE es.employee_id = $1
          AND es.merchant_id = $2
          AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(esr.status::text, 'ACTIVE')) = 'ACTIVE'`,
      [employee.id, merchant.id],
    );
    return grantsFromKeys(keys.map((row: { menuKey: string }) => row.menuKey));
  }

  async profile(user: ConsoleUser) {
    if (user.accountType === 'employee') {
      const merchant = await this.merchantRow(String(user.merchantId || ''));
      if (!merchant) throw new NotFoundException('Merchant not found');
      const employee = await this.employeeRow(String(user.employeeId || user.id || ''), merchant.id);
      if (!employee) throw new UnauthorizedException('Employee account is inactive');
      const permissions = await this.employeeGrants(employee.id, merchant.id);
      const stores = await this.employeeStores(employee.id, merchant.id);
      return {
        success: true,
        user: {
          id: employee.id,
          email: employee.email,
          firstName: employee.firstName,
          lastName: employee.lastName,
          role: 'Employee',
          accountType: 'employee',
          merchantId: merchant.id,
          merchantCode: merchant.code,
          employeeId: employee.id,
          permissions,
          stores,
        },
        permissions,
        stores,
      };
    }
    const merchant = await this.merchantRow(String(user.merchantId || user.id || ''));
    if (!merchant || merchant.status !== 'ACTIVE') throw new UnauthorizedException('Merchant account is inactive');
    const permissions = merchantGrants();
    const stores = await this.merchantStores(merchant.id);
    return {
      success: true,
      user: {
        id: user.id || merchant.id,
        email: user.email || merchant.email,
        businessDisplayName: merchant.businessName,
        role: 'OWNER',
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

  modules() {
    return { success: true, modules: moduleCatalog() };
  }

  async listEmployees(merchantId: string) {
    const merchant = await this.merchantRow(merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const rows = await this.merchants.requireDataSource().query(
      `SELECT e.id, e.email, e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_code AS "employeeCode", e.status::text AS status,
              s.id AS "storeId", s.store_name AS "storeName",
              r.id AS "roleId", r.name AS "roleName", r.role_code AS "roleCode"
         FROM public.employees e
         LEFT JOIN public.employee_stores es
           ON es.employee_id = e.id AND es.merchant_id = e.merchant_id
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

  async roleGrants(merchantId: string, roleId: string, actor?: ConsoleUser) {
    const role = await this.roleRow(merchantId, roleId);
    const grants = await this.storedGrants(role.id);
    const visible = actor?.accountType === 'employee'
      ? filterGrantsForActor(grants, await this.employeeGrants(String(actor.employeeId || actor.id || ''), role.merchantId))
      : grants;
    return { success: true, roleId: role.id, grants: visible };
  }

  async saveRoleGrants(merchantId: string, roleId: string, grants: ConsoleGrant[], actor?: ConsoleUser) {
    const role = await this.roleRow(merchantId, roleId);
    let next = Array.isArray(grants) ? grants : [];
    if (actor?.accountType === 'employee') {
      next = filterGrantsForActor(next, await this.employeeGrants(String(actor.employeeId || actor.id || ''), role.merchantId));
    }
    await this.ensurePermissionTable();
    const db = this.merchants.requireDataSource();
    await db.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM public.console_menu_permissions
          WHERE principal_role = 'MERCHANT_EMPLOYEE'
            AND role_template_id = $1::uuid`,
        [role.id],
      );
      for (const grant of next) {
        for (const action of grant.actions || []) {
          await manager.query(
            `INSERT INTO public.console_menu_permissions
               (principal_role, role_template_id, menu_key, allowed)
             VALUES ('MERCHANT_EMPLOYEE', $1::uuid, $2, true)`,
            [role.id, `${grant.menuKey}.${action}`],
          );
        }
      }
    });
    return { success: true, roleId: role.id, grants: next };
  }

  async assignEmployeeRole(merchantId: string, employeeId: string, roleId: string, storeId: string | undefined, actor?: ConsoleUser) {
    if (actor?.accountType === 'employee' && actor.employeeId === employeeId) {
      throw new ForbiddenException('Employees cannot change their own role');
    }
    const role = await this.roleRow(merchantId, roleId);
    const employee = await this.employeeRow(employeeId, role.merchantId);
    if (!employee) throw new NotFoundException('Employee not found for this merchant');
    const db = this.merchants.requireDataSource();
    const assignments = await db.query(
      `SELECT id, store_id AS "storeId"
         FROM public.employee_stores
        WHERE employee_id = $1
          AND merchant_id = $2
          AND ($3::uuid IS NULL OR store_id = $3::uuid)
          AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'`,
      [employee.id, role.merchantId, storeId || null],
    );
    if (!assignments.length) throw new NotFoundException('Assign the employee to a store before choosing a role');
    for (const assignment of assignments) {
      await db.query(
        `UPDATE public.employee_store_roles
            SET status = 'INACTIVE', updated_at = now()
          WHERE employee_store_id = $1
            AND role_id <> $2
            AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'`,
        [assignment.id, role.id],
      );
      await db.query(
        `INSERT INTO public.employee_store_roles
           (merchant_id, store_id, employee_store_id, role_id, status)
         VALUES ($1, $2, $3::uuid, $4::uuid, 'ACTIVE')
         ON CONFLICT (employee_store_id, role_id)
         DO UPDATE SET status = 'ACTIVE', updated_at = now()`,
        [role.merchantId, assignment.storeId, assignment.id, role.id],
      );
    }
    return { success: true, employeeId: employee.id, roleId: role.id };
  }

  private async storedGrants(roleId: string): Promise<ConsoleGrant[]> {
    await this.ensurePermissionTable();
    const rows = await this.merchants.requireDataSource().query(
      `SELECT menu_key AS "menuKey"
         FROM public.console_menu_permissions
        WHERE principal_role = 'MERCHANT_EMPLOYEE'
          AND role_template_id = $1::uuid
          AND allowed = true`,
      [roleId],
    );
    return grantsFromKeys(rows.map((row: { menuKey: string }) => row.menuKey));
  }

  private async ensurePermissionTable() {
    await this.merchants.requireDataSource().query(
      `CREATE TABLE IF NOT EXISTS public.console_menu_permissions (
         principal_role varchar NOT NULL,
         role_template_id uuid NULL,
         menu_key varchar NOT NULL,
         allowed boolean NOT NULL DEFAULT true
       )`,
    );
  }

  private async assertStoreMerchant(storeId: string, merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT merchant_id::text AS "merchantId" FROM public.stores WHERE id = $1::uuid LIMIT 1`,
      [storeId],
    );
    if (rows[0] && rows[0].merchantId !== merchantId) {
      throw new ForbiddenException('You can only access your own merchant records');
    }
  }

  private async merchantRow(merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id, merchant_code AS code, email,
              business_display_name AS "businessName", status::text AS status
         FROM public.merchants
        WHERE (id::text = $1 OR merchant_code = $1)
          AND COALESCE(is_deleted, false) = false
        LIMIT 1`,
      [merchantId],
    );
    return rows[0] as { id: string; code: string; email: string; businessName: string; status: string } | undefined;
  }

  private async employeeRow(employeeId: string, merchantId: string) {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id, email, first_name AS "firstName", last_name AS "lastName", status::text AS status
         FROM public.employees
        WHERE id::text = $1
          AND merchant_id::text = $2
          AND COALESCE(is_deleted, false) = false
        LIMIT 1`,
      [employeeId, merchantId],
    );
    return rows[0] as { id: string; email: string; firstName: string; lastName: string; status: string } | undefined;
  }

  private async roleRow(merchantId: string, roleId: string) {
    const merchant = await this.merchantRow(merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id
         FROM public.roles
        WHERE id::text = $1
          AND (merchant_id::text = $2 OR merchant_id::text = $3)
          AND UPPER(COALESCE(status::text, 'ACTIVE')) = 'ACTIVE'
        LIMIT 1`,
      [roleId, merchant.id, merchant.code],
    );
    if (!rows[0]) throw new NotFoundException('Role not found for this merchant');
    return { id: rows[0].id as string, merchantId: merchant.id };
  }

  private merchantStores(merchantId: string) {
    return this.merchants.requireDataSource().query(
      `SELECT id, store_code AS "storeCode", store_name AS "storeName", status
         FROM public.stores
        WHERE merchant_id::text = $1 AND COALESCE(is_deleted, false) = false
        ORDER BY store_name, id`,
      [merchantId],
    );
  }

  private employeeStores(employeeId: string, merchantId: string) {
    return this.merchants.requireDataSource().query(
      `SELECT s.id, s.store_code AS "storeCode", s.store_name AS "storeName", s.status::text AS status
         FROM public.employee_stores es
         JOIN public.stores s ON s.id = es.store_id
        WHERE es.employee_id = $1
          AND es.merchant_id = $2
          AND COALESCE(s.is_deleted, false) = false
          AND UPPER(COALESCE(es.status::text, 'ACTIVE')) = 'ACTIVE'
        ORDER BY es.is_primary DESC NULLS LAST, s.store_name`,
      [employeeId, merchantId],
    );
  }
}
