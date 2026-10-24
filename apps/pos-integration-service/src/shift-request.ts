import { BadRequestException } from '@nestjs/common';
import { ShiftStatus } from './entities/pos-shift.entity';
import { RowStatus, ShiftMetaInput, ShiftTransactionInput, ShiftWrite } from './shift.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_NAME_PATTERN = /^[a-z][a-z0-9_]{0,99}$/;
const TRANSACTION_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;

const MASTER_ALIASES: Record<string, string[]> = {
  merchant_id: ['merchant_id', 'merchantId'],
  store_id: ['store_id', 'storeId'],
  device_id: ['device_id', 'deviceId', 'terminal_id', 'terminalId'],
  opening_device_id: ['opening_device_id', 'openingDeviceId'],
  closing_device_id: ['closing_device_id', 'closingDeviceId', 'closed_by_device_id', 'closedByDeviceId'],
  created_by: ['created_by', 'createdBy', 'opened_by_employee_id', 'openedByEmployeeId'],
  updated_by: ['updated_by', 'updatedBy'],
  closed_by: ['closed_by', 'closedBy', 'closed_by_employee_id', 'closedByEmployeeId'],
  status: ['status'],
  opening_balance: ['opening_balance', 'openingBalance', 'opening_balence', 'opening_cash', 'openingCash'],
  closing_balance: ['closing_balance', 'closingBalance', 'closing_cash_actual', 'closingCashActual'],
  over_short: ['over_short', 'overShort', 'cash_difference', 'cashDifference'],
  declared_cash: ['declared_cash', 'declaredCash'],
  discrepancy: ['discrepancy'],
  opened_at: ['opened_at', 'openedAt'],
  closed_at: ['closed_at', 'closedAt'],
};

const META_FIELDS: Array<{ name: string; aliases: string[]; kind: 'text' | 'money' | 'integer' | 'json' | 'uuid' }> = [
  { name: 'cashier_name', aliases: ['cashier_name', 'cashierName'], kind: 'text' },
  { name: 'register_id', aliases: ['register_id', 'registerId'], kind: 'uuid' },
  { name: 'shift_number', aliases: ['shift_number', 'shiftNumber'], kind: 'text' },
  { name: 'opening_note', aliases: ['opening_note', 'openingNote'], kind: 'text' },
  { name: 'closing_note', aliases: ['closing_note', 'closingNote'], kind: 'text' },
  { name: 'drawer_denominations', aliases: ['drawer_denominations'], kind: 'json' },
  { name: 'tube_denominations', aliases: ['tube_denominations'], kind: 'json' },
  { name: 'drawer_total_amount', aliases: ['drawer_total_amount'], kind: 'money' },
  { name: 'tube_total_amount', aliases: ['tube_total_amount'], kind: 'money' },
  { name: 'total_amount', aliases: ['total_amount'], kind: 'money' },
  { name: 'total_orders', aliases: ['total_orders'], kind: 'integer' },
  { name: 'total_order_sale_amount', aliases: ['total_order_sale_amount'], kind: 'money' },
  { name: 'total_cancelled_orders', aliases: ['total_cancelled_orders'], kind: 'integer' },
  { name: 'total_void_items', aliases: ['total_void_items'], kind: 'integer' },
];

const SHIFT_REQUEST_KEYS = new Set<string>([
  'meta', 'shift_meta', 'transactions', 'shift_transactions', 'shift_id', 'shiftId', 'id',
]);
for (const aliases of Object.values(MASTER_ALIASES)) {
  for (const alias of aliases) SHIFT_REQUEST_KEYS.add(alias);
}
for (const field of META_FIELDS) {
  for (const alias of field.aliases) SHIFT_REQUEST_KEYS.add(alias);
}

const TOTAL_FIELDS: Array<{ aliases: string[]; transaction_type: string }> = [
  { aliases: ['total_cash_sales', 'totalCashSales'], transaction_type: 'CASH_SALE' },
  { aliases: ['total_card_sales', 'totalCardSales'], transaction_type: 'CARD_SALE' },
  { aliases: ['total_safe_drops', 'totalSafeDrops'], transaction_type: 'SAFE_DROP' },
  { aliases: ['total_paid_outs', 'totalPaidOuts'], transaction_type: 'PAID_OUT' },
  { aliases: ['total_cashback'], transaction_type: 'CASHBACK' },
  { aliases: ['total_payouts'], transaction_type: 'PAYOUT' },
  { aliases: ['total_ebt_sales'], transaction_type: 'EBT_SALE' },
  { aliases: ['total_pay_later'], transaction_type: 'PAY_LATER' },
  { aliases: ['total_refunds'], transaction_type: 'REFUND' },
];
for (const field of TOTAL_FIELDS) {
  for (const alias of field.aliases) SHIFT_REQUEST_KEYS.add(alias);
}

export function describeUnmappedShiftKeys(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>).filter((key) => !SHIFT_REQUEST_KEYS.has(key));
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be an object');
  }
  return { ...body as Record<string, unknown> };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null) return false;
  if (typeof left !== 'object' && typeof right !== 'object') return String(left) === String(right);
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function pick(source: Record<string, unknown>, names: string[], label: string): { present: boolean; value: unknown } {
  let present = false;
  let value: unknown;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(source, name) || source[name] === undefined) continue;
    if (present && !sameValue(value, source[name])) {
      throw new BadRequestException(`Conflicting values for ${label}`);
    }
    present = true;
    value = source[name];
  }
  return { present, value };
}

function readText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new BadRequestException(`${field} must be ${max} characters or fewer`);
  return trimmed;
}

function readNumber(value: unknown, field: string, options?: { min?: number; integer?: boolean }): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  if (options?.integer && !Number.isInteger(numeric)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  if (options?.min !== undefined && numeric < options.min) {
    throw new BadRequestException(`${field} must be greater than or equal to ${options.min}`);
  }
  return numeric;
}

function readDate(value: unknown, field: string): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

function readStatus(value: unknown): ShiftStatus {
  const status = readText(value, 'status', 50)?.toUpperCase();
  if (status !== ShiftStatus.OPEN && status !== ShiftStatus.CLOSED) {
    throw new BadRequestException('status must be OPEN or CLOSED');
  }
  return status;
}

function readRowStatus(value: unknown, field: string): RowStatus {
  if (value === undefined || value === null || value === '') return 'ACTIVE';
  const status = readText(value, field, 20)?.toUpperCase();
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    throw new BadRequestException(`${field} must be ACTIVE or INACTIVE`);
  }
  return status;
}

function assertJson(value: unknown, field: string): unknown {
  if (value === undefined) throw new BadRequestException(`${field} is required`);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be JSON`);
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new BadRequestException(`${field} must be JSON`);
  }
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > 100_000) {
      throw new BadRequestException(`${field} is too large`);
    }
    return JSON.parse(encoded);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`${field} must be JSON`);
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new BadRequestException(`${field} must be a valid UUID`);
}

function assertDrawer(value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => {
    const row = item as { denomination?: number; denom_count?: number };
    return !item || typeof item !== 'object'
      || !Number.isFinite(row.denomination) || Number(row.denomination) <= 0
      || !Number.isInteger(row.denom_count) || Number(row.denom_count) < 0;
  })) {
    throw new BadRequestException('drawer_denominations must contain positive denominations and non-negative integer denom_count values');
  }
}

function assertTubes(value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => {
    const row = item as { denomination?: number; tube_count?: number; cell_count?: number; total?: number };
    return !item || typeof item !== 'object'
      || !Number.isFinite(row.denomination) || Number(row.denomination) <= 0
      || !Number.isInteger(row.tube_count) || Number(row.tube_count) < 0
      || !Number.isInteger(row.cell_count) || Number(row.cell_count) < 0
      || !Number.isFinite(row.total) || Number(row.total) < 0;
  })) {
    throw new BadRequestException('tube_denominations must contain positive denominations and non-negative tube_count, cell_count, and total values');
  }
}

function normalizeMetaName(value: unknown, field: string): string {
  const name = readText(value, field, 100)?.toLowerCase();
  if (!name || !META_NAME_PATTERN.test(name)) {
    throw new BadRequestException(`${field} must be a lowercase snake_case name`);
  }
  return name;
}

function normalizeTransactionType(value: unknown, field: string): string {
  const raw = readText(value, field, 50);
  if (!raw) throw new BadRequestException(`${field} is required`);
  const type = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (!TRANSACTION_TYPE_PATTERN.test(type)) {
    throw new BadRequestException(`${field} must use letters, numbers, and underscores`);
  }
  return type;
}

function readMetaList(body: Record<string, unknown>): ShiftMetaInput[] {
  const selected = pick(body, ['meta', 'shift_meta'], 'meta');
  if (!selected.present || selected.value === null) return [];
  if (Array.isArray(selected.value)) {
    return selected.value.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(`meta[${index}] must be an object with meta_name and meta_value`);
      }
      const row = item as Record<string, unknown>;
      const name = pick(row, ['meta_name', 'metaName', 'name', 'key'], `meta[${index}].meta_name`);
      const metaValue = pick(row, ['meta_value', 'metaValue', 'value'], `meta[${index}].meta_value`);
      if (!name.present || !metaValue.present) {
        throw new BadRequestException(`meta[${index}] requires meta_name and meta_value`);
      }
      return {
        meta_name: normalizeMetaName(name.value, `meta[${index}].meta_name`),
        meta_value: assertJson(metaValue.value, `meta[${index}].meta_value`),
        status: readRowStatus(row.status, `meta[${index}].status`),
      };
    });
  }
  if (typeof selected.value === 'object') {
    return Object.entries(selected.value as Record<string, unknown>).map(([key, metaValue]) => ({
      meta_name: normalizeMetaName(key, 'meta name'),
      meta_value: assertJson(metaValue, `meta.${key}`),
      status: 'ACTIVE' as const,
    }));
  }
  throw new BadRequestException('meta must be an array of {meta_name, meta_value} or an object of key-value pairs');
}

function readTransactions(body: Record<string, unknown>): ShiftTransactionInput[] {
  const selected = pick(body, ['transactions', 'shift_transactions'], 'transactions');
  if (!selected.present || selected.value === null) return [];
  if (!Array.isArray(selected.value)) {
    throw new BadRequestException('transactions must be an array');
  }
  const seen = new Set<string>();
  return selected.value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException(`transactions[${index}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    const id = pick(row, ['id', 'transaction_id', 'transactionId'], `transactions[${index}].id`);
    let transactionId: string | undefined;
    if (id.present && id.value !== null) {
      transactionId = readText(id.value, `transactions[${index}].id`, 100) ?? undefined;
      if (!transactionId || !UUID_PATTERN.test(transactionId)) {
        throw new BadRequestException(`transactions[${index}].id must be a UUID`);
      }
      if (seen.has(transactionId)) throw new BadRequestException(`Duplicate transaction id ${transactionId}`);
      seen.add(transactionId);
    }
    const type = pick(row, ['transaction_type', 'transactionType', 'type'], `transactions[${index}].transaction_type`);
    const amount = pick(row, ['total_sum', 'totalSum', 'amount'], `transactions[${index}].total_sum`);
    if (!type.present || !amount.present) {
      throw new BadRequestException(`transactions[${index}] requires transaction_type and total_sum`);
    }
    const payload = pick(row, ['json_payload', 'jsonPayload', 'payload'], `transactions[${index}].json_payload`);
    const createdBy = pick(row, ['created_by', 'createdBy'], `transactions[${index}].created_by`);
    const updatedBy = pick(row, ['updated_by', 'updatedBy'], `transactions[${index}].updated_by`);
    return {
      id: transactionId,
      transaction_type: normalizeTransactionType(type.value, `transactions[${index}].transaction_type`),
      total_sum: readNumber(amount.value, `transactions[${index}].total_sum`),
      json_payload: payload.present ? assertJson(payload.value, `transactions[${index}].json_payload`) : {},
      status: readRowStatus(row.status, `transactions[${index}].status`),
      created_by: createdBy.present ? readText(createdBy.value, `transactions[${index}].created_by`, 100) : undefined,
      updated_by: updatedBy.present ? readText(updatedBy.value, `transactions[${index}].updated_by`, 100) : undefined,
    };
  });
}

function addMeta(meta: ShiftMetaInput[], row: ShiftMetaInput): void {
  const existing = meta.find((item) => item.meta_name === row.meta_name);
  if (!existing) {
    meta.push(row);
    return;
  }
  if (!sameValue(existing.meta_value, row.meta_value) || existing.status !== row.status) {
    throw new BadRequestException(`Conflicting values for meta ${row.meta_name}`);
  }
}

function metaFromBody(body: Record<string, unknown>, meta: ShiftMetaInput[]): void {
  for (const field of META_FIELDS) {
    const selected = pick(body, field.aliases, field.name);
    if (!selected.present) continue;
    let metaValue: unknown;
    if (field.kind === 'text') metaValue = readText(selected.value, field.name, 4000);
    else if (field.kind === 'uuid') {
      metaValue = readText(selected.value, field.name, 100);
      if (typeof metaValue === 'string') assertUuid(metaValue, field.name);
    } else if (field.kind === 'money') metaValue = readNumber(selected.value, field.name, { min: 0 });
    else if (field.kind === 'integer') metaValue = readNumber(selected.value, field.name, { min: 0, integer: true });
    else metaValue = assertJson(selected.value, field.name);
    if (metaValue === null) continue;
    if (field.name === 'drawer_denominations') assertDrawer(metaValue);
    if (field.name === 'tube_denominations') assertTubes(metaValue);
    addMeta(meta, { meta_name: field.name, meta_value: metaValue, status: 'ACTIVE' });
  }
}

function transactionsFromTotals(body: Record<string, unknown>, transactions: ShiftTransactionInput[]): void {
  for (const field of TOTAL_FIELDS) {
    const selected = pick(body, field.aliases, field.aliases[0]);
    if (!selected.present || selected.value === null) continue;
    const total = readNumber(selected.value, field.aliases[0], { min: 0 });
    if (transactions.some((row) => row.transaction_type === field.transaction_type)) continue;
    transactions.push({
      transaction_type: field.transaction_type,
      total_sum: total,
      json_payload: { source: 'shift_total' },
      status: 'ACTIVE',
      upsert_by_type: true,
    });
  }
}

function validateKnownMeta(meta: ShiftMetaInput[]): void {
  for (const row of meta) {
    if (row.meta_name === 'drawer_denominations') assertDrawer(row.meta_value);
    if (row.meta_name === 'tube_denominations') assertTubes(row.meta_value);
    if (['drawer_total_amount', 'tube_total_amount', 'total_amount', 'total_order_sale_amount'].includes(row.meta_name)) {
      readNumber(row.meta_value, row.meta_name, { min: 0 });
    }
    if (['total_orders', 'total_cancelled_orders', 'total_void_items'].includes(row.meta_name)) {
      readNumber(row.meta_value, row.meta_name, { min: 0, integer: true });
    }
    if (['cashier_name', 'opening_note', 'closing_note', 'shift_number'].includes(row.meta_name)) {
      readText(row.meta_value, row.meta_name, 4000);
    }
    if (row.meta_name === 'register_id' && row.meta_value !== null) {
      const registerId = readText(row.meta_value, 'register_id', 100);
      if (registerId) assertUuid(registerId, 'register_id');
    }
  }
}

function parse(body: Record<string, unknown>, mode: 'create' | 'update'): ShiftWrite {
  for (const names of [
    ['opened_by_employee_id', 'openedByEmployeeId'],
    ['closed_by_employee_id', 'closedByEmployeeId'],
    ['register_id', 'registerId'],
  ]) {
    const selected = pick(body, names, names[0]);
    if (selected.present && selected.value !== null) {
      const text = readText(selected.value, names[0], 100);
      if (text) assertUuid(text, names[0]);
    }
  }

  const master: ShiftWrite['master'] = {};
  const fields: string[] = [];
  for (const [field, aliases] of Object.entries(MASTER_ALIASES)) {
    const selected = pick(body, aliases, aliases.join(' / '));
    if (!selected.present) continue;
    fields.push(field);
    if (field === 'merchant_id' || field === 'store_id' || field === 'device_id') {
      master[field] = readText(selected.value, field, 100) ?? undefined;
    } else if (field === 'opening_device_id' || field === 'closing_device_id' || field === 'created_by' || field === 'updated_by' || field === 'closed_by') {
      master[field] = readText(selected.value, field, 100);
    } else if (field === 'status') {
      master.status = readStatus(selected.value);
    } else if (field === 'opening_balance') {
      master.opening_balance = readNumber(selected.value, 'opening_balance', { min: 0 });
    } else if (field === 'closing_balance' || field === 'declared_cash') {
      master[field] = selected.value === null ? null : readNumber(selected.value, field, { min: 0 });
    } else if (field === 'over_short' || field === 'discrepancy') {
      master[field] = selected.value === null ? null : readNumber(selected.value, field);
    } else if (field === 'opened_at' || field === 'closed_at') {
      master[field] = readDate(selected.value, field);
    }
  }

  const meta = readMetaList(body);
  metaFromBody(body, meta);
  const deduped: ShiftMetaInput[] = [];
  for (const row of meta) addMeta(deduped, row);
  validateKnownMeta(deduped);

  const transactions = readTransactions(body);
  transactionsFromTotals(body, transactions);

  const shiftIdPick = pick(body, ['shift_id', 'shiftId', 'id'], 'shift_id');
  let shiftId: string | undefined;
  if (shiftIdPick.present && shiftIdPick.value !== null) {
    shiftId = readText(shiftIdPick.value, 'shift_id', 100) ?? undefined;
    if (!shiftId || !/^[\x21-\x7E]{1,100}$/.test(shiftId)) {
      throw new BadRequestException('shift_id must be 1 to 100 characters without spaces');
    }
  }

  if (mode === 'create') {
    if (!master.merchant_id || !master.store_id) {
      throw new BadRequestException('merchant_id and store_id are required');
    }
    if (!fields.includes('device_id')) master.device_id = 'SUNMI-D3-01';
    if (!master.device_id) throw new BadRequestException('device_id is required');
    if (!fields.includes('opening_balance')) master.opening_balance = 200;
    if (!fields.includes('status')) master.status = ShiftStatus.OPEN;
  }

  return { shiftId, master, meta: deduped, transactions, fields };
}

export function normalizeShiftCreate(body: unknown): ShiftWrite {
  return parse(asRecord(body), 'create');
}

export function normalizeShiftUpdate(body: unknown, pathShiftId?: string): ShiftWrite & { shiftId: string } {
  const record = asRecord(body);
  if (pathShiftId !== undefined) {
    const pathId = pathShiftId.trim();
    const bodyId = pick(record, ['shift_id', 'shiftId', 'id'], 'shift_id');
    if (bodyId.present && bodyId.value !== null && readText(bodyId.value, 'shift_id', 100) !== pathId) {
      throw new BadRequestException('shift_id in the body does not match the URL');
    }
    record.shift_id = pathId;
  }
  const write = parse(record, 'update');
  if (!write.shiftId) throw new BadRequestException('shift_id is required');
  if (!write.fields.length && !write.meta.length && !write.transactions.length) {
    throw new BadRequestException('No shift fields, meta, or transactions to update');
  }
  return { ...write, shiftId: write.shiftId };
}

export function normalizeShiftClose(body: unknown): ShiftWrite & { shiftId: string } {
  const write = normalizeShiftUpdate(body);
  if (!write.fields.includes('closing_balance')) {
    throw new BadRequestException('shift_id and closing_balance (or closing_cash_actual) are required');
  }
  write.master.status = ShiftStatus.CLOSED;
  if (!write.fields.includes('status')) write.fields.push('status');
  return write;
}
