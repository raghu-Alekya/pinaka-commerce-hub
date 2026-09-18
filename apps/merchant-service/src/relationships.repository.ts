import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import { isISO8601 } from 'class-validator';
import { Relationship } from './relationships.config';

export type RelationshipOperation = 'list' | 'get' | 'create' | 'replace' | 'patch' | 'delete';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

@Injectable()
export class RelationshipsRepository implements OnModuleInit, OnModuleDestroy {
  private db!: DataSource;
  async onModuleInit() {
    this.db = new DataSource({ ...postgresConnectionOptions([]), synchronize: false });
    await this.db.initialize();
  }
  async onModuleDestroy() { if (this.db?.isInitialized) await this.db.destroy(); }

  private id(value: unknown, label: string, uuid = false): string {
    // PostgreSQL accepts canonical UUIDs without RFC version/variant bits. Existing
    // master seeds (for example b1111111-0000-0000-0000-000000000003) use that format.
    const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof value !== 'string' || !value.trim() || value.length > 100 || (uuid && !canonicalUuid.test(value))) {
      throw new BadRequestException(`${label} must be ${uuid ? 'a UUID' : 'a non-empty ID of at most 100 characters'}`);
    }
    return value;
  }

  private fields(config: Relationship, body: unknown, operation: RelationshipOperation): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Provide a JSON object');
    const values = { ...body } as Record<string, unknown>;
    if (config.name === 'StoreTypeFeatures' && 'order' in values) {
      if ('displayOrder' in values && values.displayOrder !== values.order) {
        throw new BadRequestException('Supply either order or displayOrder, not conflicting values');
      }
      values.displayOrder = values.order;
      delete values.order;
    }
    const allowed = [...Object.keys(config.fields), ...(operation === 'create' ? [config.childKey] : [])];
    if (Object.keys(values).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown or immutable field');
    if (operation === 'patch' && !Object.keys(values).length) throw new BadRequestException('Provide at least one field to update');
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(config.fields)) {
      if (!(key in values)) {
        if (operation !== 'patch') result[key] = field.default;
        continue;
      }
      const value = values[key];
      if (value === null && field.nullable) { result[key] = null; continue; }
      let valid = false;
      switch (field.kind) {
        case 'boolean': valid = typeof value === 'boolean'; break;
        case 'integer': valid = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647; break;
        case 'string': valid = typeof value === 'string' && value.length <= 100; break;
        case 'object': valid = value !== null && typeof value === 'object' && !Array.isArray(value); break;
        case 'date': valid = typeof value === 'string' && isISO8601(value, { strict: true }) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value); break;
        case 'status': valid = typeof value === 'string' && ['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(value); break;
      }
      if (!valid) throw new BadRequestException(`Invalid ${key}`);
      result[key] = value;
    }
    return result;
  }

  private dates(values: Record<string, any>) {
    for (const [start, end, allowEqual] of [['effectiveFrom', 'effectiveUntil', false], ['activatedAt', 'deactivatedAt', true]] as const) {
      if (values[start] && values[end]) {
        const a = new Date(values[start]).getTime(), b = new Date(values[end]).getTime();
        if (b < a || (!allowEqual && b === a)) throw new BadRequestException(`${end} must be after ${start}`);
      }
    }
  }

  private projection(config: Relationship) {
    return ['id', `${quoteIdent(config.parentColumn)} AS ${quoteIdent(config.parentParam)}`, `${quoteIdent(config.childColumn)} AS ${quoteIdent(config.childKey)}`,
      ...(config.tenantColumn ? [`${quoteIdent(config.tenantField || 'merchantId')} AS ${quoteIdent('merchantId')}`] : []),
      ...Object.entries(config.fields).map(([key, field]) => `${quoteIdent(field.column)} AS ${quoteIdent(key)}`),
      `${quoteIdent(config.createdColumn || 'createdAt')} AS ${quoteIdent('createdAt')}`, ...(config.timestamps ? [`${quoteIdent(config.updatedColumn || 'updatedAt')} AS ${quoteIdent('updatedAt')}`] : [])].join(', ');
  }

  async execute(config: Relationship, operation: RelationshipOperation, params: Record<string, string>, child?: string, body?: unknown) {
    const parent = this.id(params[config.parentParam], config.parentParam, config.parentUuid);
    const merchant = config.ownerColumn ? this.id(params.merchantId, 'merchantId') : undefined;
    let fields: Record<string, unknown> = {};
    if (['create', 'replace', 'patch'].includes(operation)) fields = this.fields(config, body, operation);
    if (operation === 'create') child = this.id((body as Record<string, unknown>)[config.childKey], config.childKey, config.childUuid);
    else if (operation !== 'list') child = this.id(child, config.childKey, config.childUuid);
    try {
      return await this.db.transaction(async manager => this.perform(manager, config, operation, parent, merchant, child, fields));
    } catch (error: any) {
      this.rethrow(error);
    }
  }

  async createBulk(config: Relationship, params: Record<string, string>, body: unknown) {
    const parent = this.id(params[config.parentParam], config.parentParam, config.parentUuid);
    const { items, skipExisting } = this.bulkItems(config, body);
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      throw new BadRequestException('items must contain between 1 and 100 mappings');
    }
    const seen = new Set<string>();
    const prepared = items.map(item => {
      const fields = this.fields(config, item, 'create');
      const child = this.id(item[config.childKey], config.childKey, config.childUuid);
      const normalized = config.childUuid ? child.toLowerCase() : child;
      if (seen.has(normalized)) throw new BadRequestException(`Duplicate ${config.childKey} in items`);
      seen.add(normalized);
      return { child, fields };
    });
    try {
      return await this.db.transaction(async manager => {
        const created = [];
        for (const item of prepared) {
          if (skipExisting) {
            const existing = await manager.query(
              `SELECT 1 FROM public.${config.table} WHERE ${quoteIdent(config.parentColumn)} = $1 AND ${quoteIdent(config.childColumn)} = $2`,
              [parent, item.child],
            );
            if (existing.length) continue;
          }
          const result = await this.perform(manager, config, 'create', parent, undefined, item.child, item.fields);
          created.push(result.item);
        }
        return { success: true, count: created.length, items: created };
      });
    } catch (error: any) {
      this.rethrow(error);
    }
  }

  private bulkItems(config: Relationship, body: unknown): { items: Record<string, unknown>[]; skipExisting: boolean } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Provide { items: [...] }');
    const payload = body as Record<string, unknown>;
    const idAlias = `${config.childKey}s`;
    const hasItems = 'items' in payload;
    const hasIds = idAlias in payload || 'ids' in payload;
    if (hasItems && hasIds) throw new BadRequestException(`Supply either items or ${idAlias}, not both`);
    if (hasIds) {
      if (Object.keys(payload).some(key => key !== idAlias && key !== 'ids' && key !== 'skipExisting')) {
        throw new BadRequestException(`Provide { ${idAlias}: [...] }`);
      }
      const ids = payload[idAlias] ?? payload.ids;
      if (!Array.isArray(ids)) throw new BadRequestException(`${idAlias} must be an array`);
      const defaults = config.name === 'PlanEntitlements'
        ? { enabled: true }
        : { defaultEnabled: true, required: false };
      return {
        skipExisting: payload.skipExisting !== false,
        items: ids.map(id => (typeof id === 'string' ? { [config.childKey]: id, ...defaults } : id)),
      };
    }
    if (Object.keys(payload).some(key => key !== 'items')) throw new BadRequestException('Provide { items: [...] }');
    return { items: payload.items as Record<string, unknown>[], skipExisting: false };
  }

  private async withChildDetails(manager: EntityManager, config: Relationship, items: Record<string, any>[]) {
    if (!items.length) return items;
    if (config.name === 'StoreTypeFeatures') {
      const rows = await manager.query(
        `SELECT id, name, category, status,
           COALESCE(to_jsonb(f)->>'featureKey', to_jsonb(f)->>'feature_key') AS "featureKey"
         FROM public.features f WHERE id = ANY($1::uuid[])`,
        [items.map(item => item.featureId)],
      );
      const byId = new Map(rows.map((row: Record<string, any>) => [String(row.id).toLowerCase(), row]));
      return items.map(item => {
        const feature: Record<string, any> = byId.get(String(item.featureId).toLowerCase()) || {};
        return { ...item, name: feature.name, category: feature.category, featureKey: feature.featureKey, featureStatus: feature.status };
      });
    }
    if (config.name === 'FeatureStoreTypes') {
      const rows = await manager.query(
        `SELECT id, name, description, status,
           COALESCE(to_jsonb(s)->>'storeTypeCode', to_jsonb(s)->>'store_type_code') AS "storeTypeCode"
         FROM public.store_types s WHERE id = ANY($1::uuid[])`,
        [items.map(item => item.storeTypeId)],
      );
      const byId = new Map(rows.map((row: Record<string, any>) => [String(row.id).toLowerCase(), row]));
      return items.map(item => {
        const storeType = byId.get(String(item.storeTypeId).toLowerCase()) || {};
        return { ...item, name: storeType.name, description: storeType.description, storeTypeCode: storeType.storeTypeCode, storeTypeStatus: storeType.status };
      });
    }
    if (config.name === 'StoreTypeRoleTemplates') {
      const rows = await manager.query(
        `SELECT id, name, status,
           COALESCE(to_jsonb(t)->>'roleCode', to_jsonb(t)->>'role_code') AS "roleCode",
           COALESCE(to_jsonb(t)->>'scopeType', to_jsonb(t)->>'scope_type') AS "scopeType"
         FROM public.role_templates t WHERE id = ANY($1::uuid[])`,
        [items.map(item => item.roleTemplateId)],
      );
      const byId = new Map(rows.map((row: Record<string, any>) => [String(row.id).toLowerCase(), row]));
      return items.map(item => {
        const template: Record<string, any> = byId.get(String(item.roleTemplateId).toLowerCase()) || {};
        return { ...item, name: template.name, roleCode: template.roleCode, scopeType: template.scopeType, templateStatus: template.status };
      });
    }
    return items;
  }

  private rethrow(error: any): never {
      const code = error.driverError?.code || error.code;
      if ((error.driverError?.constraint || error.constraint) === 'pch_employee_one_primary_store') {
        throw new ConflictException('Employee already has a primary store. Clear isPrimary on the old assignment first.');
      }
      if (code === '23505') throw new ConflictException('This relationship already exists');
      if (code === '23503') throw new ConflictException('Invalid parent relationship or record is in use');
      if (['23514', '22007', '22008', '22001', '22P02'].includes(code)) throw new BadRequestException('Invalid relationship values');
      if (['42P01', '42703'].includes(code)) throw new ServiceUnavailableException('Relationship schema is not installed; apply migration 03');
      throw error;
  }

  private async perform(manager: EntityManager, config: Relationship, operation: RelationshipOperation,
    parent: string, merchant: string | undefined, child: string | undefined, fields: Record<string, unknown>) {
    const owners = await manager.query(`SELECT id FROM public.${config.parentTable} WHERE id = $1${config.ownerColumn ? ` AND ${quoteIdent(config.ownerColumn)} = $2` : ''} FOR SHARE`, config.ownerColumn ? [parent, merchant] : [parent]);
    if (!owners.length) throw new NotFoundException('Parent not found in the requested scope');
    const projection = this.projection(config);
    if (operation === 'list') {
      const items = await manager.query(`SELECT ${projection} FROM public.${config.table} WHERE ${quoteIdent(config.parentColumn)} = $1 ORDER BY ${quoteIdent(config.createdColumn || 'createdAt')}, id`, [parent]);
      return { success: true, count: items.length, items: await this.withChildDetails(manager, config, items) };
    }
    if (operation === 'create') {
      let childOwner = config.childOwnerColumn || 'merchantId';
      if (config.name === 'EmployeeStores') {
        const columns = await manager.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name IN ('merchant_id','merchantId')");
        if (columns.length !== 1) throw new ServiceUnavailableException('Store ownership column is missing or ambiguous');
        childOwner = columns[0].column_name;
      }
      const children = await manager.query(`SELECT id FROM public.${config.childTable} WHERE id = $1${config.tenantColumn ? ` AND ${quoteIdent(childOwner)} = $2` : ''} FOR SHARE`, config.tenantColumn ? [child, merchant] : [child]);
      if (!children.length) throw new NotFoundException('Related record not found in the requested scope');
      this.dates(fields);
      const entries = Object.entries(fields);
      const columns = [config.parentColumn, config.childColumn, ...(config.tenantColumn ? [config.tenantField || 'merchantId'] : []), ...entries.map(([key]) => config.fields[key].column)].map(quoteIdent);
      const values = [parent, child, ...(config.tenantColumn ? [merchant] : []), ...entries.map(([,value]) => value)];
      const [item] = await manager.query(`INSERT INTO public.${config.table} (${columns.join(', ')}) VALUES (${values.map((_,i) => `$${i+1}`).join(', ')}) RETURNING ${projection}`, values);
      return { success: true, item };
    }
    const where = `${quoteIdent(config.parentColumn)} = $1 AND ${quoteIdent(config.childColumn)} = $2`;
    const [existing] = await manager.query(`SELECT ${projection} FROM public.${config.table} WHERE ${where} FOR UPDATE`, [parent, child]);
    if (!existing) throw new NotFoundException('Relationship not found');
    if (operation === 'get') return { success: true, item: existing };
    if (operation === 'delete') {
      await manager.query(`DELETE FROM public.${config.table} WHERE ${where}`, [parent, child]);
      return { success: true, message: 'Relationship removed' };
    }
    this.dates({ ...existing, ...fields });
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], i) => `${quoteIdent(config.fields[key].column)} = $${i+3}`);
    if (config.timestamps) assignments.push(`${quoteIdent(config.updatedColumn || 'updatedAt')} = clock_timestamp()`);
    // TypeORM's PostgreSQL driver returns [rows, affectedCount] for UPDATE.
    const [rows] = await manager.query(`UPDATE public.${config.table} SET ${assignments.join(', ')} WHERE ${where} RETURNING ${projection}`, [parent, child, ...entries.map(([,value])=>value)]);
    return { success: true, item: rows[0] };
  }
}
