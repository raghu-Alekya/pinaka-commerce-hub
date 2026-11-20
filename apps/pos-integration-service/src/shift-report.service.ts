import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PosRepository } from './pos.repository';
import {
  CashbackSettings,
  ReportOrder,
  ReportPayment,
  SafeDropRow,
  VendorPayoutRow,
  formatTimestamp,
  prepareShiftData,
  roundMoney,
  dailyShiftSummary,
} from './shift-report.calculations';
import { shiftDebug } from './shift-debug.log';

type ShiftRow = {
  id: string;
  store_id: string;
  device_id: string | null;
  created_by: string | null;
  status: string | null;
  opening_balance: string | number | null;
  closing_balance: string | number | null;
  over_short: string | number | null;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
};

type EmployeeRow = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { code?: string; driverError?: { code?: string } };

/**
 * WordPress `Pinaka_Shifts_Api_Controller::get_shifts_by_id_callback`.
 *
 * WooCommerce posts are stored in this service as:
 * shifts            -> pos_shifts + pos_shift_meta
 * shop orders       -> store_orders.line_items
 * payments          -> store_pos_payments (entry_type payment)
 * safedrops         -> pos_safe_drop_transactions, then pos_shift_transactions SAFE_DROP
 * vendor_payments   -> store_pos_payments payment_type vendor_payment, then VENDOR_PAYMENT transactions
 * void_items        -> store_orders line items flagged void
 * cashback settings -> store_pos_configurations cashback_settings
 * users             -> employees
 */
@Injectable()
export class ShiftReportService {
  constructor(@Inject(PosRepository) private readonly shifts: PosRepository) {}

  async getShiftById(shiftId: string | undefined, employeeId?: string): Promise<Record<string, unknown>> {
    const { db, shift, report, tillAmount } = await this.assembleShiftReport(shiftId, employeeId);
    if (tillAmount > 0) {
      shiftDebug('db', { action: 'getShiftById', table: 'pos_shift_meta', op: 'upsert', shift_id: shift.id, meta_name: 'shift_post_till_amount_value', till_amount: tillAmount });
      await this.saveTillAmount(db, shift.id, tillAmount);
    }
    return report;
  }

  /**
   * Read-only close check. Uses the same till as get-shift and does not write.
   * Over/short = counted cash - that till.
   */
  async previewClose(shiftId: string, actualClosingCash: number): Promise<{
    shiftId: string;
    actualClosingCash: number;
    expectedTillAmount: number;
    overShort: number;
    payoutTotal: number;
  }> {
    const actual = roundMoney(Number(actualClosingCash));
    if (!Number.isFinite(actual)) throw new BadRequestException('closing_cash_actual must be a number');
    const { shift, report, tillAmount } = await this.assembleShiftReport(shiftId);
    const expectedTillAmount = roundMoney(tillAmount);
    return {
      shiftId: shift.id,
      actualClosingCash: actual,
      expectedTillAmount,
      overShort: roundMoney(actual - expectedTillAmount),
      payoutTotal: roundMoney(Number(report.payout_total) || 0),
    };
  }

  async getDailyShiftSummary(storeId: string | undefined) {
    const id = storeId?.trim();
    if (!id) throw new BadRequestException('store_id or x-store-id is required');
    const db = this.shifts.requireDataSource();
    const [store] = await db.query('SELECT timezone FROM public.stores WHERE id::text=$1', [id]);
    if (!store) throw new NotFoundException('Store not found');
    let formatter: Intl.DateTimeFormat;
    try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { throw new BadRequestException('Store timezone is invalid'); }
    const shifts = await this.shifts.getShiftsByStore(id);
    const records: Array<{ date: string; report: Record<string, unknown>; orders: ReportOrder[]; payments: ReportPayment[] }> = [];
    for (let index = 0; index < shifts.length; index += 3) {
      records.push(...await Promise.all(shifts.slice(index, index + 3).map(async view => {
        const result = await this.assembleShiftReport(view.id);
        if (result.shift.store_id !== id) throw new ForbiddenException('Shift does not belong to this store');
        const parts = formatter.formatToParts(new Date(view.created_at));
        const part = (type: string) => parts.find(p => p.type === type)?.value;
        return { date: `${part('year')}-${part('month')}-${part('day')}`, report: result.report, orders: result.orders, payments: result.payments };
      })));
    }
    return { success: true, data: dailyShiftSummary(records) };
  }

  async getShiftsByDate(storeId: string | undefined, date: string | undefined) {
    const id = storeId?.trim();
    if (!id) throw new BadRequestException('store_id or x-store-id is required');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    const db = this.shifts.requireDataSource();
    const [store] = await db.query('SELECT timezone FROM public.stores WHERE id::text=$1', [id]);
    if (!store) throw new NotFoundException('Store not found');
    const timeZone = store.timezone || 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone }).format(); }
    catch { throw new BadRequestException('Store timezone is invalid'); }
    const shifts: Array<{ id: string }> = await db.query(
      `SELECT id FROM public.pos_shifts WHERE store_id::text=$1
       AND (created_at AT TIME ZONE $3)::date=$2::date ORDER BY created_at DESC,id DESC`, [id,date,timeZone],
    );
    const data: Record<string, unknown>[] = [];
    for (let index = 0; index < shifts.length; index += 3) {
      data.push(...await Promise.all(shifts.slice(index, index + 3).map(async shift => {
        const result = await this.assembleShiftReport(shift.id);
        if (result.shift.store_id !== id) throw new ForbiddenException('Shift does not belong to this store');
        const report = result.report;
        const summary = dailyShiftSummary([{ date, report, orders: result.orders, payments: result.payments }])[0];
        const cash = Number(summary.cash), card = Number(summary.card), ebt = Number(summary.ebt);
        return {
          shift_id: shift.id, user_name: report.user_name,
          start_time: report.start_time, end_time: report.end_time,
          orders_count: summary.total_orders, cancelled_orders: summary.cancelled_orders,
          total_sale_amount: roundMoney(cash + card + ebt),
          opening_balance: summary.opening_balance, closing_balance: summary.closing_balance,
          cash_total: cash, ebt_total: ebt, card_total: card,
          refund_total: summary.refund, payout_total: summary.payouts,
          void_items_count: summary.void_items, shift_status: report.shift_status,
        };
      })));
    }
    return { success: true, count: data.length, data };
  }

  private async assembleShiftReport(shiftId: string | undefined, employeeId?: string): Promise<{
    db: DataSource;
    shift: ShiftRow;
    report: Record<string, unknown>;
    tillAmount: number;
    orders: ReportOrder[];
    payments: ReportPayment[];
  }> {
    const id = shiftId?.trim() || '';
    if (!id) throw new BadRequestException('Shift ID is required');
    const employee = employeeId?.trim() || '';
    const db = this.shifts.requireDataSource();
    const shift = await this.loadShift(db, id);
    if (!shift) throw new NotFoundException('Shift not found');

    const meta = await this.loadMeta(db, shift.id);
    if (employee && !await this.shiftBelongsToEmployee(db, shift, meta, employee)) {
      throw new ForbiddenException('Shift is not associated with this employee');
    }

    const orders = await this.getShiftOrders(db, shift.id);
    const payments = await this.getShiftPayments(db, shift.id);
    await this.attachRefunds(db, orders);
    const safeDrops = await this.getShiftSafeDrops(db, shift.id);
    const vendorPayouts = await this.getShiftVendorPayoutsTotal(db, shift.id);
    const drawerTransactions = await this.getShiftDrawerTransactions(db, shift.id);
    const settings = await this.loadCashbackSettings(db, shift.store_id);
    const user = await this.loadEmployee(db, this.metaText(meta, 'user_id') || shift.created_by || '');
    const updated = this.metaText(meta, 'shift_updated') === 'shift_updated';
    const opening = updated
      ? this.metaNumber(meta, 'shift_updated_balance')
      : this.metaNumber(meta, 'opening_balance', this.number(shift.opening_balance));
    const status = (this.metaText(meta, 'status') || shift.status || 'open').toLowerCase();
    const { report, tillAmount } = prepareShiftData({
      shiftId: shift.id,
      title: this.metaText(meta, 'title') || `Shift ${shift.id}`,
      userId: this.metaText(meta, 'user_id') || shift.created_by || '',
      userName: this.employeeName(user) || this.metaText(meta, 'cashier_name'),
      assignedStaff: this.metaText(meta, 'assigned_staff'),
      startTime: this.metaText(meta, 'start_time') || formatTimestamp(shift.opened_at),
      endTime: this.metaText(meta, 'end_time') || formatTimestamp(shift.closed_at),
      openingBalance: opening,
      openingSafeCash: this.metaNumber(meta, 'opening_safe_cash'),
      closingBalance: this.metaNumber(meta, 'closing_balance', this.number(shift.closing_balance)),
      notes: this.metaText(meta, 'opening_note') || this.metaText(meta, 'notes') || this.metaText(meta, 'start_notes'),
      closingNotes: this.metaText(meta, 'closing_note') || this.metaText(meta, 'shift_closing_notes'),
      shiftStatus: status === 'closed' ? 'closed' : status,
      overShort: this.metaNumber(meta, 'over_short', this.number(shift.over_short)),
      openedAt: shift.opened_at,
      orders,
      payments,
      safeDrops,
      vendorPayouts,
      cashbackSettings: settings,
      drawerTransactions,
    });
    return { db, shift, report, tillAmount, orders, payments };
  }

  private async loadShift(db: DataSource, shiftId: string): Promise<ShiftRow | null> {
    const rows = await this.rows<ShiftRow>(db, `
      SELECT id, store_id, device_id, created_by, status, opening_balance, closing_balance,
             over_short, opened_at, closed_at
        FROM public.pos_shifts
       WHERE id = $1
       LIMIT 1
    `, [shiftId]);
    return rows[0] ?? null;
  }

  private async loadMeta(db: DataSource, shiftId: string): Promise<Map<string, unknown>> {
    const rows = await this.rows<{ meta_name: string; meta_value: unknown; status: string }>(db, `
      SELECT meta_name, meta_value, status
        FROM public.pos_shift_meta
       WHERE shift_id = $1
       ORDER BY CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END, meta_name
    `, [shiftId]);
    const meta = new Map<string, unknown>();
    for (const row of rows) meta.set(row.meta_name, row.meta_value);
    return meta;
  }

  private async getShiftOrders(db: DataSource, shiftId: string): Promise<ReportOrder[]> {
    const rows = await this.rows<ReportOrder>(db, `
      SELECT order_id::text AS order_id, client_order_id, status, total::float8 AS total,
             customer_name, payment_method_title, line_items, fee_lines, created_at
        FROM public.store_orders
       WHERE shift_id = $1 OR local_shift_id = $1
       ORDER BY created_at ASC, order_id ASC
    `, [shiftId]);
    return rows.map((row) => ({ ...row, refunded: 0, total: Number(row.total || 0), fee_lines: row.fee_lines ?? [] }));
  }

  private async getShiftPayments(db: DataSource, shiftId: string): Promise<ReportPayment[]> {
    const rows = await this.rows<ReportPayment>(db, `
      SELECT id::text AS id, order_id::text AS order_id, client_order_id,
             payment_type::text AS payment_type, payment_method, payment_method_title,
             amount::float8 AS amount, refund_amount::float8 AS refund_amount, metadata,
             payment_at, entry_type, is_void, status
        FROM public.store_pos_payments
       WHERE shift_id = $1 AND deleted_at IS NULL
       ORDER BY payment_at ASC, created_at ASC, id ASC
    `, [shiftId]);
    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount || 0),
      refund_amount: Number(row.refund_amount || 0),
      is_void: row.is_void === true,
    }));
  }

  private async attachRefunds(db: DataSource, orders: ReportOrder[]): Promise<void> {
    const ids = orders.map((order) => order.order_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return;
    const rows = await this.rows<{ order_id: string; refunded: number }>(db, `
      SELECT order_id::text AS order_id,
             (
               COALESCE(SUM(refund_amount) FILTER (WHERE entry_type = 'payment'), 0)
               + COALESCE(SUM(amount) FILTER (
                   WHERE entry_type = 'refund'
                     AND COALESCE(metadata->>'daily_refund_tracking', 'false') <> 'true'
                 ), 0)
             )::float8 AS refunded
        FROM public.store_pos_payments
       WHERE order_id = ANY($1::uuid[])
         AND deleted_at IS NULL
         AND is_void = false
       GROUP BY order_id
    `, [ids]);
    const refunded = new Map(rows.map((row) => [row.order_id, Number(row.refunded || 0)]));
    for (const order of orders) order.refunded = refunded.get(order.order_id) || 0;
  }

  private async getShiftDrawerTransactions(db: DataSource, shiftId: string): Promise<Array<{ id: string; transaction_type: string; total_sum: number; json_payload: Record<string, unknown> | null; status: string }>> {
    const rows = await this.rows<{ id: string; transaction_type: string; total_sum: number; json_payload: Record<string, unknown> | null; status: string }>(db, `
      SELECT id::text AS id, transaction_type, total_sum::float8 AS total_sum, json_payload, status
        FROM public.pos_shift_transactions
       WHERE shift_id = $1 AND status = 'ACTIVE'
       ORDER BY created_at ASC, id ASC
    `, [shiftId]);
    return rows.map((row) => ({ ...row, total_sum: Number(row.total_sum || 0) }));
  }

  private async getShiftSafeDrops(db: DataSource, shiftId: string): Promise<SafeDropRow[]> {
    const stored = await this.rows<{ id: string; safe_data: Record<string, unknown> | null; created_at: Date | string | null }>(db, `
      SELECT id::text AS id, safe_data, created_at
        FROM public.pos_safe_drop_transactions
       WHERE shift_id = $1
       ORDER BY created_at ASC, id ASC
    `, [shiftId]);
    const drops = stored.map((row) => this.safeDropFromRecord(row.id, row.safe_data, row.created_at));
    const seen = new Set(drops.map((drop) => drop.id));
    const transactions = await this.rows<{ id: string; total_sum: number; json_payload: Record<string, unknown> | null; created_at: Date | string | null }>(db, `
      SELECT id::text AS id, total_sum::float8 AS total_sum, json_payload, created_at
        FROM public.pos_shift_transactions
       WHERE shift_id = $1 AND status = 'ACTIVE' AND transaction_type = 'SAFE_DROP'
       ORDER BY created_at ASC, id ASC
    `, [shiftId]);
    for (const row of transactions) {
      const payload = row.json_payload || {};
      const linked = String(payload.safe_drop_id || '');
      if (linked && seen.has(linked)) continue;
      if (seen.has(row.id)) continue;
      drops.push(this.safeDropFromRecord(linked || row.id, { ...payload, total_cash: payload.total_cash ?? row.total_sum }, row.created_at));
    }
    return drops;
  }

  private safeDropFromRecord(id: string, data: Record<string, unknown> | null, time: Date | string | null): SafeDropRow {
    const payload = data || {};
    const total = Number(payload.total_cash ?? payload.total ?? 0);
    return {
      id,
      total: Number.isFinite(total) ? total : 0,
      denominations: payload.safe_drop_denom ?? payload.denominations ?? payload._safedrops_data ?? null,
      note: String(payload.note ?? payload.safe_drop_note ?? ''),
      time: formatTimestamp(time),
    };
  }

  private async getShiftVendorPayoutsTotal(db: DataSource, shiftId: string): Promise<VendorPayoutRow[]> {
    const payments = await this.rows<ReportPayment>(db, `
      SELECT id::text AS id, order_id::text AS order_id, client_order_id,
             payment_type::text AS payment_type, payment_method, payment_method_title,
             amount::float8 AS amount, metadata, payment_at
        FROM public.store_pos_payments
       WHERE shift_id = $1
         AND deleted_at IS NULL
         AND is_void = false
         AND payment_type::text = 'vendor_payment'
       ORDER BY payment_at ASC, id ASC
    `, [shiftId]);
    const rows = payments.map((payment) => this.vendorFromPayment(payment));
    if (!rows.length) {
      const transactions = await this.rows<{ id: string; total_sum: number; json_payload: Record<string, unknown> | null; created_at: Date | string | null }>(db, `
        SELECT id::text AS id, total_sum::float8 AS total_sum, json_payload, created_at
          FROM public.pos_shift_transactions
         WHERE shift_id = $1 AND status = 'ACTIVE' AND transaction_type = 'VENDOR_PAYMENT'
         ORDER BY created_at ASC, id ASC
      `, [shiftId]);
      for (const row of transactions) rows.push(this.vendorFromPayload(row.id, Number(row.total_sum || 0), row.json_payload, row.created_at));
    }
    const saved = await this.rows<{ id: string; amount: number; description: string; payment_mode: string; vendor_name: string; vendor_id: string; created_at: Date }>(db, `
      SELECT p.id::text AS id,p.amount::float8 AS amount,p.description,p.payment_mode,p.vendor_name,p.vendor_id::text AS vendor_id,p.created_at
      FROM public.store_vendor_payments p JOIN public.pos_shifts s ON s.id=p.shift_id
      WHERE p.shift_id=$1 AND p.store_id::text=s.store_id AND p.merchant_id::text=s.merchant_id
        AND p.is_deleted=false AND p.status='ACTIVE'
      ORDER BY p.created_at,p.id`, [shiftId]);
    for (const payment of saved) rows.push(this.vendorFromPayload(payment.id, payment.amount, {
      note: payment.description, payment_method: payment.payment_mode, vendor_name: payment.vendor_name, vendor_id: payment.vendor_id,
    }, payment.created_at));
    await this.attachVendorNames(db, rows);
    return rows;
  }

  private vendorFromPayment(payment: ReportPayment): VendorPayoutRow {
    const metadata = payment.metadata || {};
    const source = metadata.source_payload && typeof metadata.source_payload === 'object'
      ? metadata.source_payload as Record<string, unknown>
      : {};
    return this.vendorFromPayload(payment.id, Number(payment.amount || 0), { ...source, ...metadata, payment_method: payment.payment_method }, payment.payment_at);
  }

  private vendorFromPayload(id: string, amount: number, payload: Record<string, unknown> | null, time: Date | string | null): VendorPayoutRow {
    const data = payload || {};
    return {
      id,
      amount,
      note: String(data.note ?? data.notes ?? data._vendor_payment_notes ?? ''),
      payment_method: String(data.payment_method ?? data._vendor_payment_method ?? ''),
      time: formatTimestamp(time),
      vendor_name: String(data.vendor_name ?? data.vendor ?? ''),
      service_type: String(data.service_type ?? data._vendor_payment_service_type ?? ''),
      vendor_id: String(data.vendor_id ?? data._vendor_id ?? ''),
    };
  }

  private async attachVendorNames(db: DataSource, rows: VendorPayoutRow[]): Promise<void> {
    const ids = [...new Set(rows.map((row) => row.vendor_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!ids.length) return;
    const names = await this.rows<{ id: string; vendor_name: string }>(db, `
      SELECT id::text AS id, vendor_name
        FROM public.vendors
       WHERE id::text = ANY($1::text[])
    `, [ids]);
    const byId = new Map(names.map((row) => [row.id, row.vendor_name]));
    for (const row of rows) {
      if (!row.vendor_name && byId.has(row.vendor_id)) row.vendor_name = byId.get(row.vendor_id) || '';
    }
  }

  private async loadCashbackSettings(db: DataSource, storeId: string): Promise<CashbackSettings | null> {
    const rows = await this.rows<{ configuration_value: CashbackSettings }>(db, `
      SELECT configuration_value
        FROM public.store_pos_configurations
       WHERE store_id::text = $1 AND configuration_name = 'cashback_settings'
       LIMIT 1
    `, [storeId]);
    return rows[0]?.configuration_value ?? null;
  }

  private async loadEmployee(db: DataSource, employeeId: string): Promise<EmployeeRow | null> {
    if (!employeeId) return null;
    const rows = await this.rows<EmployeeRow>(db, `
      SELECT id::text AS id, user_id::text AS user_id, first_name, last_name
        FROM public.employees
       WHERE id::text = $1 OR user_id::text = $1
       LIMIT 1
    `, [employeeId]);
    if (rows.length || await this.columnExists(db, 'employees', 'user_id')) return rows[0] ?? null;
    const fallback = await this.rows<EmployeeRow>(db, `
      SELECT id::text AS id, NULL::text AS user_id, first_name, last_name
        FROM public.employees
       WHERE id::text = $1
       LIMIT 1
    `, [employeeId]);
    return fallback[0] ?? null;
  }

  private async shiftBelongsToEmployee(db: DataSource, shift: ShiftRow, meta: Map<string, unknown>, employeeId: string): Promise<boolean> {
    const wanted = employeeId.toLowerCase();
    const owners = [shift.created_by, this.metaText(meta, 'user_id'), this.metaText(meta, 'assigned_staff')]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (owners.includes(wanted)) return true;
    const employee = await this.loadEmployee(db, employeeId);
    if (!employee) return false;
    const identities = [employee.id, employee.user_id].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    return owners.some((owner) => identities.includes(owner));
  }

  private async saveTillAmount(db: DataSource, shiftId: string, tillAmount: number): Promise<void> {
    const rounded = Math.round((tillAmount + Number.EPSILON) * 100) / 100;
    await this.rows(db, `
      INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
      VALUES ($1, $2, 'shift_post_till_amount_value', to_jsonb($3::numeric), 'ACTIVE')
      ON CONFLICT (shift_id, meta_name) DO UPDATE
        SET meta_value = EXCLUDED.meta_value, status = 'ACTIVE'
    `, [randomUUID(), shiftId, rounded]);
  }

  private async columnExists(db: DataSource, table: string, column: string): Promise<boolean> {
    const rows = await this.rows<{ found: boolean }>(db, `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) AS found
    `, [table, column]);
    return rows[0]?.found === true;
  }

  private async rows<T>(db: DataSource, sql: string, params: unknown[]): Promise<T[]> {
    try {
      return await db.query(sql, params);
    } catch (error) {
      const code = (error as QueryError).driverError?.code || (error as QueryError).code;
      if (code === '42P01' || code === '42703' || code === '22P02') return [];
      throw error;
    }
  }

  private metaText(meta: Map<string, unknown>, key: string): string {
    const value = meta.get(key);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  private metaNumber(meta: Map<string, unknown>, key: string, fallback = 0): number {
    if (!meta.has(key)) return fallback;
    const amount = Number(meta.get(key));
    return Number.isFinite(amount) ? amount : fallback;
  }

  private number(value: string | number | null | undefined): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  private employeeName(employee: EmployeeRow | null): string {
    if (!employee) return '';
    return `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  }
}
