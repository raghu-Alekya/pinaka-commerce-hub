import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';

type Row = Record<string, any>;
const normalize = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));

@Injectable()
export class EmployeeAccessRepository implements OnModuleInit, OnModuleDestroy {
  private db!: DataSource;
  async onModuleInit() {
    this.db = new DataSource({ ...postgresConnectionOptions([]), synchronize: false });
    await this.db.initialize();
  }
  async onModuleDestroy() { if (this.db?.isInitialized) await this.db.destroy(); }

  // Tables and field names are internal constants, never request-controlled SQL.
  private async read(manager: EntityManager, table: string, field: string, value: string): Promise<Row[]> {
    const snake = field.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
    const rows = await manager.query(`SELECT to_jsonb(t) AS row FROM public.${table} t
      WHERE COALESCE(to_jsonb(t)->>$1,to_jsonb(t)->>$2)=$3`, [field, snake, value]);
    return rows.map((result: { row: Row }) => normalize(result.row));
  }

  async resolve(employeeId: string, storeId: string, permissionKey?: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)) {
      throw new BadRequestException('employeeId must be a UUID');
    }
    if (!storeId.trim() || (permissionKey !== undefined && !permissionKey.trim())) {
      throw new BadRequestException('Provide non-empty scope and permission identifiers');
    }
    try {
      return await this.db.transaction('REPEATABLE READ', async manager => {
        const [employee] = await this.read(manager, 'employees', 'id', employeeId);
        const [store] = await this.read(manager, 'stores', 'id', storeId);
        if (!employee || !store || store.merchantUuid !== employee.merchantId) {
          throw new NotFoundException('Employee and store were not found in the same merchant');
        }
        const merchantId = employee.merchantId;
        const [merchant] = await this.read(manager, 'merchants', 'id', merchantId);
        const now = Date.now();
        const active = (row: Row | undefined) => row?.status === 'ACTIVE';
        const inPeriod = (row: Row) => (!row.effectiveFrom || Date.parse(row.effectiveFrom) <= now) &&
          (!row.effectiveUntil || Date.parse(row.effectiveUntil) > now);
        const [assignment] = (await this.read(manager, 'employee_stores', 'employeeId', employeeId))
          .filter(row => row.storeId === storeId && row.merchantId === merchantId && active(row) && inPeriod(row));
        const roleLinks = assignment ? (await this.read(manager, 'employee_store_roles', 'employeeStoreId', assignment.id))
          .filter(row => row.merchantId === merchantId && active(row) && inPeriod(row)) : [];
        const roles: Row[] = [];
        const granted = new Set<string>();
        for (const link of roleLinks) {
          const [role] = await this.read(manager, 'roles', 'id', link.roleId);
          if (!active(role) || role.merchantId !== merchant.merchantCode) continue;
          roles.push(role);
          const grants = await this.read(manager, 'role_permissions', 'roleId', role.id);
          const storeMatches = (grant: Row) => [store.id, store.uuid, store.legacyStoreId].filter(Boolean).includes(grant.storeId);
          for (const grant of grants.filter(row => !row.storeId)) {
            if (grant.allowed === true) granted.add(grant.permissionId);
            else granted.delete(grant.permissionId);
          }
          for (const grant of grants.filter(storeMatches)) {
            if (grant.allowed === true) granted.add(grant.permissionId);
            else granted.delete(grant.permissionId);
          }
        }
        const licensedSubscriptions: Row[] = [];
        for (const license of await this.read(manager, 'subscription_stores', 'storeId', storeId)) {
          if (![merchantId, merchant.merchantCode].includes(license.merchantId) || !active(license) ||
              (license.activatedAt && Date.parse(license.activatedAt) > now) ||
              (license.deactivatedAt && Date.parse(license.deactivatedAt) <= now)) continue;
          const [subscription] = await this.read(manager, 'subscriptions', 'id', license.subscriptionId);
          if (!subscription || ![merchantId, merchant.merchantCode].includes(subscription.merchantId) || !['ACTIVE', 'TRIAL', 'TRIALING'].includes(subscription.status) ||
              (subscription.startDate && Date.parse(subscription.startDate) > now) ||
              (subscription.currentPeriodEnd && Date.parse(subscription.currentPeriodEnd) <= now) ||
              (subscription.cancelledAt && Date.parse(subscription.cancelledAt) <= now)) continue;
          const [plan] = subscription.planId ? await this.read(manager, 'plans', 'id', subscription.planId) : [];
          if (active(plan)) licensedSubscriptions.push(subscription);
        }
        let [storeType] = await this.read(manager, 'store_types', 'id', store.storeTypeId || store.storeType || '');
        if (!storeType) [storeType] = await this.read(manager, 'store_types', 'storeTypeCode', store.storeTypeId || store.storeType || '');
        const relevant = new Set<string>(active(storeType)
          ? (await this.read(manager, 'store_type_features', 'storeTypeId', storeType.id)).map(row => row.featureId) : []);
        const storeOverrides = (await this.read(manager, 'store_entitlements', 'storeId', storeId)).filter(inPeriod);
        const entitled = new Set<string>();
        for (const subscription of licensedSubscriptions) {
          const features = new Map<string, boolean>();
          for (const entry of await this.read(manager, 'plan_entitlements', 'planId', subscription.planId)) features.set(entry.featureId, entry.enabled === true);
          for (const entry of (await this.read(manager, 'subscription_entitlements', 'subscriptionId', subscription.id)).filter(inPeriod)) {
            features.set(entry.featureId, entry.enabled === true);
          }
          for (const [featureId, enabled] of features) if (enabled) entitled.add(featureId);
        }
        const permissions = permissionKey
          ? await this.read(manager, 'permissions', 'permissionKey', permissionKey.trim().toUpperCase())
          : (await manager.query('SELECT to_jsonb(p) AS row FROM public.permissions p ORDER BY permission_key')).map((r: { row: Row }) => normalize(r.row));
        if (permissionKey && !permissions.length) throw new NotFoundException('Permission not found');
        const results = [];
        for (const permission of permissions) {
          const [feature] = await this.read(manager, 'features', 'id', permission.featureId);
          const storeOverride = storeOverrides.find(row => row.featureId === permission.featureId);
          const reason = !active(employee) ? 'EMPLOYEE_INACTIVE'
            : !active(store) ? 'STORE_INACTIVE'
            : !assignment ? 'STORE_ASSIGNMENT_MISSING'
            : !licensedSubscriptions.length ? 'STORE_NOT_LICENSED'
            : !active(permission) ? 'PERMISSION_INACTIVE'
            : !active(feature) ? 'FEATURE_INACTIVE'
            : !relevant.has(permission.featureId) ? 'FEATURE_NOT_RELEVANT'
            : !entitled.has(permission.featureId) ? 'FEATURE_NOT_ENTITLED'
            : storeOverride?.enabled === false ? 'STORE_FEATURE_DISABLED'
            : !roles.length ? 'ROLE_MISSING'
            : !granted.has(permission.id) ? 'PERMISSION_MISSING' : 'ALLOWED';
          results.push({ permissionId: permission.id, permissionKey: permission.permissionKey,
            featureId: permission.featureId, featureKey: feature?.featureKey,
            entitled: entitled.has(permission.featureId), roleAllowed: granted.has(permission.id),
            allowed: reason === 'ALLOWED', reason });
        }
        return { success: true, merchantId, employeeId, storeId, evaluatedAt: new Date(now).toISOString(),
          employeeStoreId: assignment?.id || null, roleIds: roles.map(role => role.id), count: results.length, permissions: results };
      });
    } catch (error: any) {
      if (['42P01', '42703'].includes(error.driverError?.code || error.code)) {
        throw new ServiceUnavailableException('Effective access requires the store-type and subscription entitlement schemas');
      }
      throw error;
    }
  }
}
