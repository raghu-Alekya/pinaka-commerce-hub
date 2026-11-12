import { HttpException } from '@nestjs/common';

/**
 * Temporary shift-flow logging. Remove this module after the POS save issue is diagnosed.
 * Passwords, pins, tokens, and card data are redacted.
 */
const SENSITIVE_KEY = /password|passwd|pin|token|secret|authorization|cookie|card.?number|cvv|cvc|pan|ssn/i;
const MAX_TEXT = 12000;

export function shiftDebug(event: string, details: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(redact(details));
  } catch {
    text = '"[unserializable]"';
  }
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}…[truncated]`;
  console.log(`[shift-debug] ${event} ${text}`);
}

export function shiftErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return { status: error.getStatus(), response: redact(error.getResponse()) };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function summarizeShiftWrite(write: {
  shiftId?: string;
  fields: string[];
  master: object;
  meta: Array<{ meta_name: string; meta_value: unknown; status: string }>;
  transactions: Array<{
    id?: string;
    transaction_type: string;
    total_sum: number;
    json_payload: unknown;
    status: string;
    upsert_by_type?: boolean;
  }>;
}): Record<string, unknown> {
  return {
    shift_id: write.shiftId ?? null,
    pos_shifts: { fields: write.fields, values: write.master },
    pos_shift_meta: write.meta.map((row) => ({
      meta_name: row.meta_name,
      status: row.status,
      meta_value: row.meta_value,
    })),
    pos_shift_transactions: write.transactions.map((row) => ({
      id: row.id ?? null,
      transaction_type: row.transaction_type,
      total_sum: row.total_sum,
      status: row.status,
      upsert_by_type: row.upsert_by_type === true,
      json_payload: row.json_payload,
    })),
  };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map((item) => redact(item, depth + 1));
    if (value.length > 40) items.push(`[+${value.length - 40} more]`);
    return items;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}
