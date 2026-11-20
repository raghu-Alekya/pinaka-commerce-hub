import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

let announced = false;

function projectRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'apps', 'order-service'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/** Separate from the Nest service log. Override with PAYROC_PAYMENT_LOG when the server cwd is not the project. */
export function payrocPaymentLogPath(): string {
  const override = process.env.PAYROC_PAYMENT_LOG?.trim();
  if (override) return isAbsolute(override) ? override : join(projectRoot(process.cwd()), override);
  return join(projectRoot(process.cwd()), 'logs', 'payroc-payments.log');
}

export function logPayrocPayment(event: string, details: Record<string, unknown> = {}): void {
  const file = payrocPaymentLogPath();
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details,
  });
  // The service process log keeps a copy so a server that hides the file still shows the payment line.
  console.log(`[PayrocPayment] ${line}`);
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${line}\n`, 'utf8');
    if (!announced) {
      announced = true;
      console.log(`[PayrocPayment] file ${file}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unable to write payment log';
    console.error(`[PayrocPayment] log write failed at ${file}: ${message}`);
  }
}
