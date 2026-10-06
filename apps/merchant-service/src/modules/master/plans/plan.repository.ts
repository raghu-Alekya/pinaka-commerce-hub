import * as crypto from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';

@Injectable()
export class PlanRepository {
  private sequenceReady?: Promise<void>;
  constructor(@Inject(MerchantRepository) private readonly merchant: MerchantRepository) {}

  private async ensureCodeSequence(): Promise<void> {
    if (!this.sequenceReady) {
      this.sequenceReady = this.merchant.requireDataSource().transaction(async manager => {
        // Serialize initial sequence creation across service processes.
        await manager.query('SELECT pg_advisory_xact_lock(724621, 42)');
        const [existing] = await manager.query("SELECT to_regclass('public.pch_plan_code_seq') AS name");
        if (existing.name) return;
        await manager.query('CREATE SEQUENCE public.pch_plan_code_seq');
        await manager.query(`SELECT setval('public.pch_plan_code_seq',
          (SELECT COALESCE(MAX(substring(plan_code FROM '^PLAN-([0-9]+)$')::bigint), 0) + 1 FROM public.plans), false)`);
      }).catch(error => { this.sequenceReady = undefined; throw error; });
    }
    await this.sequenceReady;
  }

  async listActiveForMerchant(): Promise<Array<Record<string, unknown>>> {
    return this.merchant.requireDataSource().query(`
      SELECT
        p.id,
        p.plan_code AS "planCode",
        p.name,
        p.description,
        p.base_price::numeric AS "basePrice",
        p.currency,
        p.billing_cycle AS "billingCycle",
        p.stores_limit AS "includedStores",
        p.terminal_limit AS "includedTerminals",
        p.employees_limit AS "includedEmployees",
        p.included_features AS "includedFeatures",
        p.trial_period AS "trialPeriod",
        p.store_type_id AS "storeTypeId",
        jsonb_build_object(
          'id', st.id,
          'code', COALESCE(to_jsonb(st)->>'storeTypeCode', to_jsonb(st)->>'store_type_code', ''),
          'name', st.name
        ) AS "storeType"
      FROM public.plans p
      JOIN public.store_types st ON st.id = p.store_type_id
      WHERE p.status = 'ACTIVE'
        AND COALESCE(p.is_deleted, false) = false
        AND COALESCE(st.status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(st.is_deleted, false) = false
      ORDER BY st.name, p.name, p.id
    `);
  }

  async execute(operation: 'list' | 'get' | 'create' | 'update' | 'delete', id?: string, fields: Record<string, unknown> = {}, userId?: string): Promise<any> {
    const dataSource = this.merchant.requireDataSource();
    const writable = ['name', 'description', 'status', 'billing_model', 'base_price', 'currency', 'billing_cycle',
      'store_type_id', 'stores_limit', 'terminal_limit', 'additional_terminal_price', 'employees_limit',
      'additional_employee_price', 'trial_period', 'effective_from', 'plan_end_date', 'included_features'];
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const projection = ['id', 'plan_code', ...writable, 'is_deleted', 'created_by', 'updated_by', 'created_at', 'updated_at'].map(quote).join(', ');
    let entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.some(([key]) => !writable.includes(key))) throw new BadRequestException('Unknown or server-managed plan field');
    if (operation === 'create' || operation === 'update') {
      if (!userId) throw new UnauthorizedException('Authenticated user is required');
      if (operation === 'update' && !entries.length) throw new BadRequestException('Provide at least one field to update');
      entries = [...entries, [operation === 'create' ? 'created_by' : 'updated_by', userId]];
    }
    if (operation === 'delete' && !userId) throw new UnauthorizedException('Authenticated user is required');
    let sql: string;
    let values: unknown[] = [];
    if (operation === 'list') sql = `SELECT ${projection} FROM public.plans ORDER BY name, id`;
    else if (operation === 'get') {
      // GET by ID and list include soft-deleted plans.
      sql = `SELECT ${projection} FROM public.plans WHERE id = $1`;
      values = [id];
    } else if (operation === 'create') {
      await this.ensureCodeSequence();
      values = [crypto.randomUUID(), ...entries.map(([, value]) => value)];
      // nextval is atomic across concurrent inserts; do not derive codes from row counts.
      const code = `(SELECT 'PLAN-' || repeat('0', GREATEST(0, 6 - length(n::text))) || n::text FROM nextval('public.pch_plan_code_seq') AS n)`;
      sql = `INSERT INTO public.plans (id, plan_code, ${entries.map(([key]) => quote(key)).join(', ')}) VALUES ($1, ${code}, ${entries.map((_, index) => `$${index + 2}`).join(', ')}) RETURNING ${projection}`;
    } else if (operation === 'update') {
      values = [id, ...entries.map(([, value]) => value)];
      const restore = fields.status === 'ACTIVE' ? ', is_deleted = false' : '';
      sql = `UPDATE public.plans SET ${entries.map(([key], index) => `${quote(key)} = $${index + 2}`).join(', ')}${restore}, updated_at = clock_timestamp() WHERE id = $1 RETURNING ${projection}`;
    } else {
      sql = `UPDATE public.plans SET is_deleted = true, status = 'INACTIVE', updated_by = $2, updated_at = clock_timestamp() WHERE id = $1 AND is_deleted = false RETURNING ${projection}`;
      values = [id, userId];
    }
    try {
      const result = operation === 'create'
        ? await dataSource.transaction(async manager => {
            // Serialize creates for the same normalized name to avoid concurrent duplicates.
            await manager.query('SELECT pg_advisory_xact_lock(724621, hashtext(lower(btrim($1))))', [fields.name]);
            const duplicates = await manager.query(
              'SELECT id FROM public.plans WHERE lower(btrim(name)) = lower(btrim($1)) LIMIT 1',
              [fields.name],
            );
            if (duplicates.length) {
              throw new ConflictException(`Plan name '${String(fields.name).trim()}' already exists`);
            }
            return manager.query(sql, values);
          })
        : await dataSource.query(sql, values);
      const rows = operation === 'update' || operation === 'delete' ? result[0] : result;
      if (operation === 'list') return rows;
      if (!rows.length) throw new NotFoundException('Plan not found');
      return rows[0];
    } catch (error: any) {
      const code = error.driverError?.code || error.code;
      if (code === '23505') throw new ConflictException('Plan code already exists');
      if (code === '23503') throw new ConflictException('Referenced record is missing or the plan is in use.');
      if (code === '42P01' || code === '42703') throw new ServiceUnavailableException('Plan table schema is not installed');
      throw error;
    }
  }
}
