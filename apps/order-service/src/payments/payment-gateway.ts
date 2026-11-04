import { randomUUID } from 'node:crypto';

/**
 * Kickback and Payroc calls follow
 * Pinaka_Payments_Api_Controller::payment_create_callback and get_payroc_token.
 * Payroc stays on the same UAT hosts the WordPress plugin calls.
 */
export const KICKBACK_SALE_URL = 'https://kicbac.transactiongateway.com/api/transact.php';
export const PAYROC_AUTHORIZE_URL = 'https://identity.uat.payroc.com/authorize';
export const PAYROC_API_URL = 'https://api.uat.payroc.com';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GatewayCredentials {
  deviceId: string;
  terminalId: string;
  secretKey: string;
  processorMerchantId: string;
}

export type GatewayName = 'kickback' | 'payroc';

export type GatewayOutcome =
  | { kind: 'approved'; transactionId: string; details: Record<string, unknown> }
  | { kind: 'declined'; message: string; response?: unknown }
  | { kind: 'failed'; statusCode: number; message: string };

export type ResolvedGateway =
  | { ok: true; gateway: 'offline' }
  | { ok: true; gateway: GatewayName; credentials: GatewayCredentials }
  | { ok: false; message: string };

const EMPTY_CREDENTIALS: GatewayCredentials = {
  deviceId: '',
  terminalId: '',
  secretKey: '',
  processorMerchantId: '',
};

type PayrocTokenCache = Map<string, { token: string; expiresAt: number }>;

const payrocTokens: PayrocTokenCache = new Map();

export function isPhpEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'boolean') return value === false;
  if (typeof value === 'number') return value === 0 || Number.isNaN(value);
  if (typeof value === 'string') return value === '' || value === '0';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** WordPress isset($amount) plus the numeric cast used before the gateway call. */
export function readPaymentAmount(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === '') return 0;
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

export function normalizeGatewayName(value: unknown): 'kickback' | 'payroc' | 'offline' | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'kickback') return 'kickback';
  if (text === 'payroc' || text === 'payrock') return 'payroc';
  if (text === 'default' || text === 'offline') return 'offline';
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function credentialText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function readCredentials(provider: Record<string, unknown>): GatewayCredentials {
  return {
    deviceId: credentialText(provider, ['deviceId', 'device_id']),
    terminalId: credentialText(provider, ['terminalId', 'terminal_id']),
    secretKey: credentialText(provider, ['secretKey', 'secret_key']),
    processorMerchantId: credentialText(provider, ['processorMerchantId', 'processor_merchant_id']),
  };
}

/**
 * WordPress charges only the gateway named by pinaka_payment_gateway_provider.
 * Saved Kickback or Payroc credentials do not by themselves enable a gateway.
 * `default` and `offline` match the WordPress Offline radio and skip the processor.
 */
export function resolvePaymentGateway(configuration: unknown): ResolvedGateway {
  const document = asRecord(
    typeof configuration === 'string'
      ? safeJson(configuration)
      : configuration,
  ) ?? {};
  const providers = Array.isArray(document.providers)
    ? document.providers.flatMap((item) => {
      const record = asRecord(item);
      const gateway = record ? normalizeGatewayName(record.provider) : null;
      if (!record || (gateway !== 'kickback' && gateway !== 'payroc')) return [];
      return [{ gateway, credentials: readCredentials(record) }];
    })
    : [];

  const selectorKeys = [
    'payment_gateway_provider',
    'pinaka_payment_gateway_provider',
    'selectedProvider',
    'selected_provider',
  ];
  let selected: 'kickback' | 'payroc' | 'offline' | null = null;
  for (const key of selectorKeys) {
    selected = normalizeGatewayName(document[key]);
    if (selected) break;
  }
  if (!selected && typeof document.provider === 'string') {
    selected = normalizeGatewayName(document.provider);
  }

  if (selected === 'offline') return { ok: true, gateway: 'offline' };
  if (selected === 'kickback' || selected === 'payroc') {
    const match = providers.find((item) => item.gateway === selected);
    return { ok: true, gateway: selected, credentials: match?.credentials ?? EMPTY_CREDENTIALS };
  }
  if (providers.length === 0) return { ok: true, gateway: 'offline' };
  return {
    ok: false,
    message: 'Card gateway is not selected. Set payment_gateway_provider to kickback, payroc, or default. Saved credentials are not treated as enabled.',
  };
}

export function interpretKickback(raw: string): GatewayOutcome {
  const details: Record<string, unknown> = {};
  const params = new URLSearchParams(raw);
  for (const [key, value] of params) details[key] = value;
  if (details.response !== '1') {
    const text = details.responsetext;
    return {
      kind: 'declined',
      message: typeof text === 'string' && text ? text : 'Card declined',
    };
  }
  return {
    kind: 'approved',
    transactionId: typeof details.transactionid === 'string' ? details.transactionid : '',
    details,
  };
}

export function interpretPayroc(raw: string): GatewayOutcome {
  const parsed = safeJson(raw);
  const record = asRecord(parsed);
  if (record && hasPayrocErrors(record.errors)) {
    return { kind: 'declined', message: 'Payroc payment failed', response: parsed };
  }
  const details = record ?? {};
  return {
    kind: 'approved',
    transactionId: typeof details.paymentInstructionId === 'string' ? details.paymentInstructionId : '',
    details,
  };
}

/** WordPress skips only transactionid when copying gateway fields onto the payment. */
export function transactionFields(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'transactionid'));
}

export function chargeKickback(
  input: { deviceId: string; secretKey: string; amount: number },
  fetchImpl: FetchLike,
): Promise<GatewayOutcome> {
  const body = new URLSearchParams({
    security_key: input.secretKey,
    type: 'sale',
    amount: input.amount.toFixed(2),
    poi_device_id: input.deviceId,
    response_method: 'synchronous',
  });
  return postGateway(KICKBACK_SALE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(120_000),
  }, fetchImpl, (raw) => interpretKickback(raw), 'Card payment failed');
}

export async function chargePayroc(
  input: {
    deviceId: string;
    terminalId: string;
    secretKey: string;
    amount: number;
    orderId: string;
    operator: string;
  },
  fetchImpl: FetchLike,
  cache: PayrocTokenCache = payrocTokens,
): Promise<GatewayOutcome> {
  const token = await payrocToken(input.secretKey, fetchImpl, cache);
  if (!token) {
    return { kind: 'failed', statusCode: 500, message: 'Unable to obtain Payroc token' };
  }
  const payload = {
    processingTerminalId: input.terminalId,
    operator: input.operator,
    order: {
      orderId: input.orderId,
      description: `WooCommerce Order #${input.orderId}`,
      currency: 'USD',
      amount: Math.round(input.amount * 100),
    },
    autoCapture: true,
    processAsSale: false,
  };
  return postGateway(
    `${PAYROC_API_URL}/v1/devices/${encodeURIComponent(input.deviceId)}/payment-instructions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    },
    fetchImpl,
    (raw) => interpretPayroc(raw),
    'Payroc payment failed',
  );
}

async function postGateway(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  interpret: (raw: string) => GatewayOutcome,
  fallback: string,
): Promise<GatewayOutcome> {
  try {
    const response = await fetchImpl(url, init);
    return interpret(await response.text());
  } catch (error: unknown) {
    return {
      kind: 'failed',
      statusCode: 500,
      message: error instanceof Error && error.message ? error.message : fallback,
    };
  }
}

async function payrocToken(apiKey: string, fetchImpl: FetchLike, cache: PayrocTokenCache): Promise<string> {
  const cached = cache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  try {
    const response = await fetchImpl(PAYROC_AUTHORIZE_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
    });
    const parsed = asRecord(safeJson(await response.text()));
    const token = typeof parsed?.access_token === 'string'
      ? parsed.access_token
      : typeof parsed?.token === 'string' ? parsed.token : '';
    if (!token) return '';
    cache.set(apiKey, { token, expiresAt: Date.now() + 3_500_000 });
    return token;
  } catch {
    return '';
  }
}

function hasPayrocErrors(errors: unknown): boolean {
  if (errors == null || errors === false || errors === '') return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return typeof errors === 'object' ? true : Boolean(errors);
}

function safeJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
