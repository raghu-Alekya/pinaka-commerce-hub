import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const paymentLogPath = join(process.cwd(), 'logs', 'payroc-payments.log');

/** Payment lines go to logs/payroc-payments.log, separate from the service console log. */
export function logPayrocPayment(event: string, details: Record<string, unknown>): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details,
  });
  try {
    mkdirSync(dirname(paymentLogPath), { recursive: true });
    appendFileSync(paymentLogPath, `${line}\n`, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unable to write payment log';
    console.error(`[Payment] log write failed: ${message}`);
  }
}
