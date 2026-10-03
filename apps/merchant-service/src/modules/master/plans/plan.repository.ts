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

  async execute(operation: 'list' | 'get' | 'create' | 'update' | 'delete', id?: string, fields: Record<string, unknown> = {}, userId?: string): Promise<any> {
    const dataSource = this.merchant.requireDataSource();
    const writable = ['name', 'description', 'status', 'billing_model', 'base_price', 'currency', 'billing_cycle',
      'store_type_id', 'stores_limit', 'terminal_limit', 'additional_terminal_price', 'employees_limit',
      'additional_employee_price', 'trial_period', 'effective_from', 'plan_end_date', 'included_features', 'is_deleted'];
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const projection = ['id', 'plan_code', ...writable, 'created_by', 'updated_by', 'created_at', 'updated_at'].map(quote).join(', ');
    let entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.some(([key]) => !writable.includes(key))) throw new BadRequestException('Unknown or server-managed plan field');
    if (operation === 'create' || operation === 'update') {
      if (!userId) throw new UnauthorizedException('Authenticated user is required');
      if (operation === 'update' && !entries.length) throw new BadRequestException('Provide at least one field to update');
      // Keep status and deletion state in sync in the same INSERT/UPDATE.
      // Explicit status takes precedence if both fields are supplied.
      if (fields.status !== undefined) {
        entries = entries.filter(([key]) => key !== 'is_deleted');
        entries.push(['is_deleted', fields.status === 'INACTIVE']);
      } else if (fields.is_deleted !== undefined) {
        entries.push(['status', fields.is_deleted ? 'INACTIVE' : 'ACTIVE']);
      } else if (operation === 'create') {
        entries.push(['status', 'ACTIVE'], ['is_deleted', false]);
      }
      entries = [...entries, [operation === 'create' ? 'created_by' : 'updated_by', userId]];
    }
    let sql: string;
    let values: unknown[] = [];
    if (operation === 'list') sql = `SELECT ${projection} FROM public.plans ORDER BY name, id`;
    else if (operation === 'get') {
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
      sql = `UPDATE public.plans SET ${entries.map(([key], index) => `${quote(key)} = $${index + 2}`).join(', ')}, updated_at = clock_timestamp() WHERE id = $1 RETURNING ${projection}`;
    } else {
      sql = `DELETE FROM public.plans WHERE id = $1 RETURNING ${projection}`;
      values = [id];
    }
    try {
      const result = await dataSource.query(sql, values);
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
