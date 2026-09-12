import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import { isISO8601 } from 'class-validator';
import { Relationship } from './relationships.config';

export type RelationshipOperation = 'list' | 'get' | 'create' | 'replace' | 'patch' | 'delete';

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
    const values = body as Record<string, unknown>;
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
    return ['id', `${config.parentColumn} AS "${config.parentParam}"`, `${config.childColumn} AS "${config.childKey}"`,
      ...(config.tenantColumn ? ['merchant_id AS "merchantId"'] : []),
      ...Object.entries(config.fields).map(([key, field]) => `${field.column} AS "${key}"`),
      'created_at AS "createdAt"', ...(config.timestamps ? ['updated_at AS "updatedAt"'] : [])].join(', ');
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
      const code = error.driverError?.code || error.code;
      if (code === '23505') throw new ConflictException('This relationship already exists');
      if (code === '23503') throw new ConflictException('Invalid parent relationship or record is in use');
      if (['23514', '22007', '22008', '22001', '22P02'].includes(code)) throw new BadRequestException('Invalid relationship values');
      if (['42P01', '42703'].includes(code)) throw new ServiceUnavailableException('Relationship schema is not installed; apply migration 03');
      throw error;
    }
  }

  private async perform(manager: EntityManager, config: Relationship, operation: RelationshipOperation,
    parent: string, merchant: string | undefined, child: string | undefined, fields: Record<string, unknown>) {
    const owners = await manager.query(`SELECT id FROM public.${config.parentTable} WHERE id = $1${config.ownerColumn ? ` AND "${config.ownerColumn}" = $2` : ''} FOR SHARE`, config.ownerColumn ? [parent, merchant] : [parent]);
    if (!owners.length) throw new NotFoundException('Parent not found in the requested scope');
    const projection = this.projection(config);
    if (operation === 'list') {
      const items = await manager.query(`SELECT ${projection} FROM public.${config.table} WHERE ${config.parentColumn} = $1 ORDER BY created_at, id`, [parent]);
      return { success: true, count: items.length, items };
    }
    if (operation === 'create') {
      const children = await manager.query(`SELECT id FROM public.${config.childTable} WHERE id = $1${config.tenantColumn ? ' AND merchant_id = $2' : ''} FOR SHARE`, config.tenantColumn ? [child, merchant] : [child]);
      if (!children.length) throw new NotFoundException('Related record not found in the requested scope');
      this.dates(fields);
      const entries = Object.entries(fields);
      const columns = [config.parentColumn, config.childColumn, ...(config.tenantColumn ? ['merchant_id'] : []), ...entries.map(([key]) => config.fields[key].column)];
      const values = [parent, child, ...(config.tenantColumn ? [merchant] : []), ...entries.map(([,value]) => value)];
      const [item] = await manager.query(`INSERT INTO public.${config.table} (${columns.join(', ')}) VALUES (${values.map((_,i) => `$${i+1}`).join(', ')}) RETURNING ${projection}`, values);
      return { success: true, item };
    }
    const where = `${config.parentColumn} = $1 AND ${config.childColumn} = $2`;
    const [existing] = await manager.query(`SELECT ${projection} FROM public.${config.table} WHERE ${where} FOR UPDATE`, [parent, child]);
    if (!existing) throw new NotFoundException('Relationship not found');
    if (operation === 'get') return { success: true, item: existing };
    if (operation === 'delete') {
      await manager.query(`DELETE FROM public.${config.table} WHERE ${where}`, [parent, child]);
      return { success: true, message: 'Relationship removed' };
    }
    this.dates({ ...existing, ...fields });
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], i) => `${config.fields[key].column} = $${i+3}`);
    if (config.timestamps) assignments.push('updated_at = clock_timestamp()');
    // TypeORM's PostgreSQL driver returns [rows, affectedCount] for UPDATE.
    const [rows] = await manager.query(`UPDATE public.${config.table} SET ${assignments.join(', ')} WHERE ${where} RETURNING ${projection}`, [parent, child, ...entries.map(([,value])=>value)]);
    return { success: true, item: rows[0] };
  }
}
