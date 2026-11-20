import { createHash, randomUUID } from 'node:crypto';
import { logPayrocPayment } from './payment-log';

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
  | { kind: 'declined'; message: string; response?: unknown; transactionId?: string; details?: Record<string, unknown> }
  | { kind: 'pending'; transactionId: string; message: string; details: Record<string, unknown> }
  | { kind: 'failed'; statusCode: number; message: string; uncertain?: boolean; details?: Record<string, unknown> };

export type ResolvedGateway =
  | { ok: true; gateway: 'offline' }
  | { ok: true; gateway: GatewayName; credentials: GatewayCredentials }
  | { ok: false; message: string };

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

interface ListedGateway {
  gateway: GatewayName;
  credentials: GatewayCredentials;
  enabled: boolean;
  isDefault: boolean;
}

/**
 * card_payment_settings stores the gateway list on `cardPayments`.
 * Older documents use `providers`. Disabled entries are ignored.
 * An enabled `isDefault` gateway is the store choice. A request or saved
 * selector is used only when it names an enabled gateway. No enabled
 * gateway, or several enabled gateways without a default, is an error.
 * Records that omit `enabled` stay enabled so older single-gateway
 * documents keep working. `offline` / `default` still records the tender
 * without calling a processor.
 */
export function resolvePaymentGateway(configuration: unknown, requested?: unknown): ResolvedGateway {
  const document = asRecord(
    typeof configuration === 'string'
      ? safeJson(configuration)
      : configuration,
  ) ?? {};
  const source = Array.isArray(document.cardPayments)
    ? document.cardPayments
    : Array.isArray(document.providers) ? document.providers : [];
  const providers: ListedGateway[] = source.flatMap((item) => {
    const record = asRecord(item);
    const gateway = record ? normalizeGatewayName(record.provider) : null;
    if (!record || (gateway !== 'kickback' && gateway !== 'payroc')) return [];
    return [{
      gateway,
      credentials: readCredentials(record),
      enabled: flagEnabled(record),
      isDefault: flagDefault(record),
    }];
  });

  const requestedName = normalizeGatewayName(requested);
  if (requestedName === 'offline') return { ok: true, gateway: 'offline' };
  if (requestedName === 'kickback' || requestedName === 'payroc') {
    return enabledGateway(providers, requestedName);
  }

  const enabled = providers.filter((item) => item.enabled);
  const defaults = enabled.filter((item) => item.isDefault);
  if (defaults.length === 1) return usableGateway(defaults[0]);
  if (defaults.length > 1) {
    return { ok: false, message: 'Multiple card payment gateways are marked as the default' };
  }

  const documentName = documentGatewayName(document);
  if (documentName === 'offline') return { ok: true, gateway: 'offline' };
  if (documentName === 'kickback' || documentName === 'payroc') {
    return enabledGateway(providers, documentName);
  }
  if (enabled.length === 1) return usableGateway(enabled[0]);
  if (enabled.length === 0) return { ok: false, message: 'No card payment gateway is enabled' };
  return { ok: false, message: 'Multiple card payment gateways are enabled and none is the default' };
}

function documentGatewayName(document: Record<string, unknown>): 'kickback' | 'payroc' | 'offline' | null {
  const selectorKeys = [
    'payment_gateway_provider',
    'pinaka_payment_gateway_provider',
    'selectedProvider',
    'selected_provider',
  ];
  for (const key of selectorKeys) {
    const selected = normalizeGatewayName(document[key]);
    if (selected) return selected;
  }
  return typeof document.provider === 'string' ? normalizeGatewayName(document.provider) : null;
}

function enabledGateway(providers: ListedGateway[], gateway: GatewayName): ResolvedGateway {
  const match = providers.find((item) => item.gateway === gateway);
  if (!match) return { ok: false, message: `Card payment gateway ${gateway} is not configured` };
  if (!match.enabled) return { ok: false, message: `Card payment gateway ${gateway} is disabled` };
  return usableGateway(match);
}

function usableGateway(gateway: ListedGateway): ResolvedGateway {
  const missing = missingCredentialFields(gateway);
  if (missing.length) {
    return { ok: false, message: `${gatewayLabel(gateway.gateway)} ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required` };
  }
  return { ok: true, gateway: gateway.gateway, credentials: gateway.credentials };
}

function gatewayLabel(gateway: GatewayName): string {
  return gateway === 'payroc' ? 'Payroc' : 'Kickback';
}

function missingCredentialFields(gateway: ListedGateway): string[] {
  const missing: string[] = [];
  if (!gateway.credentials.deviceId) missing.push('device ID');
  if (!gateway.credentials.secretKey) missing.push('secret key');
  if (gateway.gateway === 'payroc' && !gateway.credentials.terminalId) missing.push('terminal ID');
  return missing;
}

function flagEnabled(record: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, 'enabled')) return true;
  const value = record.enabled;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') return false;
  return !isPhpEmpty(value);
}

export function readPosDeviceId(requestPayload: unknown): { ok: true; posDeviceId: string } | { ok: false; message: string } {
  let payload = requestPayload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return { ok: false, message: 'Order request_payload is missing or invalid' };
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, message: 'Order request_payload is missing or invalid' };
    }
  }
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.meta_data)) {
    return { ok: false, message: 'Order request_payload is missing or invalid' };
  }
  const matches = record.meta_data.filter((entry) => asRecord(entry)?.key === 'pos_device_id');
  const ids = [...new Set(matches.map((entry) => credentialText(asRecord(entry) ?? {}, ['value'])).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: 'Order pos_device_id is missing' };
  if (ids.length > 1) return { ok: false, message: 'Order pos_device_id is ambiguous' };
  return { ok: true, posDeviceId: ids[0] };
}

/** The Payroc device serial for this POS, taken from the store's enabled Payroc deviceMappings. */
export function payrocCardTerminalDeviceId(
  configuration: unknown,
  posDeviceId: string,
): { ok: true; cardTerminalDeviceId: string } | { ok: false; message: string } {
  const document = asRecord(
    typeof configuration === 'string' ? safeJson(configuration) : configuration,
  );
  if (!document) return { ok: false, message: 'Card payment settings were not found for this store' };
  const source = Array.isArray(document.cardPayments)
    ? document.cardPayments
    : Array.isArray(document.providers) ? document.providers : null;
  if (!source) return { ok: false, message: 'Card payment settings were not found for this store' };
  const payroc = source.flatMap((item) => {
    const record = asRecord(item);
    if (!record || normalizeGatewayName(record.provider) !== 'payroc') return [];
    return [record];
  });
  if (payroc.length === 0) return { ok: false, message: 'Payroc configuration was not found' };
  const enabled = payroc.filter((record) => flagEnabled(record));
  if (enabled.length === 0) return { ok: false, message: 'Payroc configuration is disabled' };
  if (enabled.length > 1) return { ok: false, message: 'Multiple Payroc configurations are enabled' };
  const mappings = Array.isArray(enabled[0].deviceMappings) ? enabled[0].deviceMappings : [];
  const matches = mappings.flatMap((item) => {
    const mapping = asRecord(item);
    if (!mapping) return [];
    const deviceCode = credentialText(mapping, ['deviceCode', 'device_code']);
    if (deviceCode !== posDeviceId) return [];
    return [mapping];
  });
  if (matches.length === 0) return { ok: false, message: `No Payroc terminal is mapped to POS device ${posDeviceId}` };
  if (matches.length > 1) return { ok: false, message: `Multiple Payroc terminals are mapped to POS device ${posDeviceId}` };
  const cardTerminalDeviceId = credentialText(matches[0], ['cardTerminalDeviceId', 'card_terminal_device_id']);
  if (!cardTerminalDeviceId) {
    return { ok: false, message: `Payroc card terminal device ID is empty for POS device ${posDeviceId}` };
  }
  return { ok: true, cardTerminalDeviceId };
}

function flagDefault(record: Record<string, unknown>): boolean {
  const value = Object.prototype.hasOwnProperty.call(record, 'isDefault')
    ? record.isDefault
    : record.is_default;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') return true;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') return false;
  return value === true;
}

export function payrocOrderReference(...candidates: Array<unknown>): string {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim().replace(/^#/, '');
    if (value.length >= 1 && value.length <= 24) return value;
  }
  const compact = candidates
    .map((candidate) => String(candidate ?? '').replace(/[^A-Za-z0-9]/g, ''))
    .find((value) => value.length > 0);
  return (compact || 'order').slice(0, 24);
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

const PAYROC_INSTRUCTION_PENDING = new Set(['inprogress', 'in_progress', 'pending', 'processing', 'sent', 'received']);
const PAYROC_INSTRUCTION_DONE = new Set(['completed', 'complete', 'success', 'successful']);
const PAYROC_INSTRUCTION_STOP = new Set(['failure', 'failed', 'canceled', 'cancelled', 'declined', 'error']);
const PAYROC_API_HOSTS = new Set(['api.uat.payroc.com', 'api.payroc.com']);

/** Stable Payroc Idempotency-Key for one payment attempt. A new attempt needs a new seed. */
export function payrocIdempotencyKey(seed: string): string {
  const trimmed = seed.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const hex = createHash('sha256').update(`payroc:${trimmed}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = Number.parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

/**
 * A payment-instruction body is not a finished sale. `inProgress` means the
 * device still has the prompt. Approval comes from the payment resource.
 */
export function interpretPayroc(raw: string): GatewayOutcome {
  const parsed = safeJson(raw);
  const record = asRecord(parsed);
  if (!record) return { kind: 'declined', message: 'Payroc payment failed', response: parsed ?? raw };
  if (isPayrocProblem(record)) return payrocProblem(record, parsed);
  const status = payrocStatus(record);
  const instructionId = textValue(record.paymentInstructionId);
  const sanitized = sanitizeGatewayPayload(record) as Record<string, unknown>;
  if (PAYROC_INSTRUCTION_STOP.has(status)) {
    return {
      kind: 'declined',
      message: payrocInstructionMessage(record, 'Payroc payment failed'),
      response: sanitized,
      transactionId: instructionId,
      details: sanitized,
    };
  }
  if (PAYROC_INSTRUCTION_DONE.has(status)) {
    return {
      kind: 'pending',
      transactionId: instructionId,
      message: 'Payroc payment instruction completed and is awaiting the payment result',
      details: sanitized,
    };
  }
  return {
    kind: 'pending',
    transactionId: instructionId,
    message: 'Payroc payment is in progress',
    details: sanitized,
  };
}

/** Processor approval or decline from GET /v1/payments/{paymentId}. */
export function interpretPayrocPayment(raw: string): GatewayOutcome {
  const parsed = safeJson(raw);
  const record = asRecord(parsed);
  if (!record) return { kind: 'declined', message: 'Payroc payment failed', response: parsed ?? raw };
  if (isPayrocProblem(record)) return payrocProblem(record, parsed);
  const sanitized = sanitizeGatewayPayload(record) as Record<string, unknown>;
  const result = asRecord(record.transactionResult);
  const paymentId = textValue(record.paymentId);
  if (!result) {
    return {
      kind: 'pending',
      transactionId: paymentId,
      message: 'Payroc payment did not include a transaction result',
      details: sanitized,
    };
  }
  const code = textValue(result.responseCode).toUpperCase();
  const status = payrocStatus(result);
  const message = textValue(result.responseMessage) || textValue(result.approvalCode) || 'Card declined';
  if (payrocPaymentApproved(code, status)) {
    return { kind: 'approved', transactionId: paymentId, details: sanitized };
  }
  if (code === 'P' || PAYROC_INSTRUCTION_PENDING.has(status)) {
    return {
      kind: 'pending',
      transactionId: paymentId,
      message: message || 'Payroc payment is in progress',
      details: sanitized,
    };
  }
  return { kind: 'declined', message, response: sanitized, transactionId: paymentId, details: sanitized };
}

export function sanitizeGatewayPayload(value: unknown): unknown {
  return sanitizeValue(value);
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

export interface PayrocChargeInput {
  deviceId: string;
  terminalId: string;
  secretKey: string;
  processorMerchantId?: string;
  amount: number;
  currency?: string;
  orderId: string;
  operator: string;
  idempotencyKey?: string;
  /** When a previous attempt already created an instruction, poll that instruction. */
  instructionId?: string;
}

/**
 * Card-present sale: POST the instruction, poll until it leaves inProgress,
 * then read the payment. A timeout does not submit another instruction.
 * The same Idempotency-Key resumes the original instruction.
 */
export async function chargePayroc(
  input: PayrocChargeInput,
  fetchImpl: FetchLike,
  cache: PayrocTokenCache = payrocTokens,
  options?: { maxPolls?: number },
): Promise<GatewayOutcome> {
  const token = await payrocToken(input.secretKey, fetchImpl, cache);
  if (!token) {
    return { kind: 'failed', statusCode: 500, message: 'Unable to obtain Payroc token', uncertain: false };
  }
  const idempotencyKey = payrocIdempotencyKey(input.idempotencyKey || input.instructionId || randomUUID());
  const gatewayOrderId = payrocOrderReference(input.orderId);
  const currency = (input.currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
  const payload = {
    processingTerminalId: input.terminalId,
    operator: input.operator.slice(0, 64),
    order: {
      orderId: gatewayOrderId,
      description: `WooCommerce Order #${gatewayOrderId}`,
      currency,
      amount: Math.round(input.amount * 100),
    },
    customizationOptions: { entryMethod: 'deviceRead' },
    autoCapture: true,
    processAsSale: false,
  };
  const context = {
    provider: 'payroc',
    idempotency_key: idempotencyKey,
    gateway_request: payload,
    terminal_id: input.terminalId,
    processor_merchant_id: input.processorMerchantId || '',
    gateway_submitted: false,
  };
  if (input.instructionId) {
    return finishPayrocInstruction(input.instructionId, token, fetchImpl, context, options?.maxPolls ?? 4);
  }
  const paymentUrl = `${PAYROC_API_URL}/v1/devices/${encodeURIComponent(input.deviceId)}/payment-instructions`;
  logPayrocPayment('payroc_request', {
    orderId: gatewayOrderId,
    cardTerminalDeviceId: input.deviceId,
    terminalId: input.terminalId,
    url: paymentUrl,
  });
  const submitted = await requestPayroc(
    paymentUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(35_000),
    },
    fetchImpl,
  );
  const submittedContext = { ...context, gateway_submitted: true };
  if (!submitted.ok) return attachPayrocContext(submitted.outcome, submittedContext);
  const instruction = readPayrocInstruction(submitted.raw, submitted.status);
  if (instruction.type === 'failed') {
    return attachPayrocContext({
      kind: 'declined',
      message: instruction.message,
      response: instruction.body,
      details: asRecord(sanitizeGatewayPayload(instruction.body)) ?? {},
    }, submittedContext);
  }
  return finishPayrocInstruction(instruction.id, token, fetchImpl, {
    ...submittedContext,
    instruction: instruction.body,
    paymentInstructionId: instruction.id,
  }, options?.maxPolls ?? 4, instruction);
}

/** Read an instruction that was already submitted. This does not create a charge. */
export async function continuePayroc(
  input: { secretKey: string; instructionId?: string; paymentId?: string },
  fetchImpl: FetchLike,
  cache: PayrocTokenCache = payrocTokens,
): Promise<GatewayOutcome> {
  const token = await payrocToken(input.secretKey, fetchImpl, cache);
  if (!token) {
    return { kind: 'failed', statusCode: 500, message: 'Unable to obtain Payroc token', uncertain: false };
  }
  if (input.paymentId && !input.instructionId) {
    return readPayrocPayment(input.paymentId, token, fetchImpl, { gateway_submitted: true, provider: 'payroc' });
  }
  if (!input.instructionId) {
    return { kind: 'failed', statusCode: 400, message: 'Payroc payment identifier is required', uncertain: false };
  }
  return finishPayrocInstruction(input.instructionId, token, fetchImpl, {
    provider: 'payroc',
    gateway_submitted: true,
    paymentInstructionId: input.instructionId,
  }, 1);
}

type PayrocContext = Record<string, unknown>;

interface PayrocInstructionView {
  type: 'pending' | 'completed' | 'stopped' | 'failed';
  id: string;
  message: string;
  body: Record<string, unknown>;
}

async function finishPayrocInstruction(
  instructionId: string,
  token: string,
  fetchImpl: FetchLike,
  context: PayrocContext,
  maxPolls: number,
  initial?: PayrocInstructionView,
): Promise<GatewayOutcome> {
  let current = initial;
  let fetches = 0;
  const limit = Math.max(1, maxPolls);
  while ((!current || current.type === 'pending') && fetches < limit && instructionId) {
    fetches += 1;
    const loaded = await requestPayroc(
      `${PAYROC_API_URL}/v1/payment-instructions/${encodeURIComponent(instructionId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(70_000),
      },
      fetchImpl,
    );
    if (!loaded.ok) {
      return attachPayrocContext({
        kind: 'pending',
        transactionId: instructionId,
        message: 'Payroc payment is in progress',
        details: {
          paymentInstructionId: instructionId,
          poll_error: loaded.outcome.kind === 'approved' || loaded.outcome.kind === 'pending'
            ? 'Payroc payment is in progress'
            : loaded.outcome.message,
          uncertain: true,
        },
      }, { ...context, gateway_submitted: true });
    }
    current = readPayrocInstruction(loaded.raw, loaded.status);
    if (!current.id) current = { ...current, id: instructionId };
  }
  if (!current || current.type === 'pending') {
    return attachPayrocContext({
      kind: 'pending',
      transactionId: current?.id || instructionId,
      message: 'Payroc payment is in progress',
      details: {
        ...(current ? { instruction: current.body } : {}),
        paymentInstructionId: current?.id || instructionId,
      },
    }, { ...context, gateway_submitted: Boolean(instructionId) || context.gateway_submitted === true });
  }
  const withInstruction = {
    ...context,
    gateway_submitted: true,
    instruction: current.body,
    paymentInstructionId: current.id || instructionId,
  };
  if (current.type === 'stopped' || current.type === 'failed') {
    return attachPayrocContext({
      kind: 'declined',
      message: current.message,
      response: current.body,
      transactionId: current.id || instructionId,
      details: { instruction: current.body, paymentInstructionId: current.id || instructionId },
    }, withInstruction);
  }
  const paymentId = payrocLinkedPaymentId(current.body);
  if (!paymentId) {
    return attachPayrocContext({
      kind: 'pending',
      transactionId: current.id || instructionId,
      message: 'Payroc payment instruction completed and is awaiting the payment result',
      details: { instruction: current.body, paymentInstructionId: current.id || instructionId },
    }, withInstruction);
  }
  return readPayrocPayment(paymentId, token, fetchImpl, withInstruction);
}

async function readPayrocPayment(
  paymentId: string,
  token: string,
  fetchImpl: FetchLike,
  context: PayrocContext,
): Promise<GatewayOutcome> {
  const loaded = await requestPayroc(
    `${PAYROC_API_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(35_000),
    },
    fetchImpl,
  );
  if (!loaded.ok) return attachPayrocContext(loaded.outcome, context);
  const outcome = interpretPayrocPayment(loaded.raw);
  const response = outcome.kind === 'approved' ? outcome.details : outcome.details ?? asRecord(sanitizeGatewayPayload(safeJson(loaded.raw))) ?? {};
  return attachPayrocContext(outcome, { ...context, gateway_response: response, paymentId });
}

async function requestPayroc(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<{ ok: true; status: number; raw: string } | { ok: false; outcome: GatewayOutcome }> {
  try {
    const response = await fetchImpl(url, init);
    const raw = await response.text();
    if (response.status >= 400) {
      const parsed = safeJson(raw);
      const record = asRecord(parsed);
      const instructionId = record ? textValue(record.paymentInstructionId) : '';
      if (response.status === 409 && instructionId) {
        return { ok: true, status: response.status, raw };
      }
      const message = record && isPayrocProblem(record)
        ? payrocInstructionMessage(record, 'Payroc payment failed')
        : 'Payroc payment failed';
      return {
        ok: false,
        outcome: {
          kind: 'declined',
          message,
          response: record ? sanitizeGatewayPayload(record) : raw,
          ...(instructionId ? { transactionId: instructionId } : {}),
          details: record ? asRecord(sanitizeGatewayPayload(record)) ?? {} : {},
        },
      };
    }
    return { ok: true, status: response.status, raw };
  } catch (error: unknown) {
    return { ok: false, outcome: transportFailure(error, 'Payroc payment failed') };
  }
}

function readPayrocInstruction(raw: string, httpStatus: number): PayrocInstructionView {
  const parsed = safeJson(raw);
  const record = asRecord(parsed) ?? {};
  const id = textValue(record.paymentInstructionId);
  if (isPayrocProblem(record) || httpStatus >= 400) {
    return {
      type: httpStatus === 409 && id ? 'pending' : 'failed',
      id,
      message: payrocInstructionMessage(record, 'Payroc payment failed'),
      body: asRecord(sanitizeGatewayPayload(record)) ?? {},
    };
  }
  const status = payrocStatus(record);
  const body = asRecord(sanitizeGatewayPayload(record)) ?? {};
  if (PAYROC_INSTRUCTION_STOP.has(status)) {
    return { type: 'stopped', id, message: payrocInstructionMessage(record, 'Payroc payment failed'), body };
  }
  if (PAYROC_INSTRUCTION_DONE.has(status)) return { type: 'completed', id, message: '', body };
  if (!status || PAYROC_INSTRUCTION_PENDING.has(status)) {
    return { type: 'pending', id, message: 'Payroc payment is in progress', body };
  }
  return { type: 'pending', id, message: 'Payroc payment is in progress', body };
}

function attachPayrocContext(outcome: GatewayOutcome, context: PayrocContext): GatewayOutcome {
  const details = {
    ...context,
    ...(outcome.kind === 'failed' ? outcome.details ?? {} : {}),
    ...(outcome.kind === 'approved' || outcome.kind === 'pending' ? outcome.details : {}),
    ...(outcome.kind === 'declined' ? outcome.details ?? {} : {}),
  };
  if (outcome.kind === 'approved') return { ...outcome, details };
  if (outcome.kind === 'pending') return { ...outcome, details };
  if (outcome.kind === 'declined') return { ...outcome, details };
  return { ...outcome, details };
}

function payrocLinkedPaymentId(instruction: Record<string, unknown>): string {
  const links = [instruction.link, ...(Array.isArray(instruction.links) ? instruction.links : [])];
  for (const entry of links) {
    const link = asRecord(entry);
    if (!link || String(link.rel || '') !== 'payment' || typeof link.href !== 'string') continue;
    try {
      const url = new URL(link.href);
      if (!PAYROC_API_HOSTS.has(url.host)) continue;
      const match = url.pathname.match(/\/v1\/payments\/([^/]+)$/);
      if (match) return decodeURIComponent(match[1]);
    } catch {
      continue;
    }
  }
  return '';
}

function payrocPaymentApproved(code: string, status: string): boolean {
  if (['declined', 'failed', 'failure', 'error', 'void', 'voided', 'reversed', 'canceled', 'cancelled'].includes(status)) {
    return false;
  }
  if (code && code !== 'A') return false;
  if (code === 'A') return true;
  return ['ready', 'approved', 'accepted'].includes(status);
}

function payrocStatus(record: Record<string, unknown>): string {
  return textValue(record.status).toLowerCase();
}

function payrocInstructionMessage(record: Record<string, unknown>, fallback: string): string {
  const detail = record.detail;
  if (!hasPayrocErrors(record.errors) && typeof detail === 'string' && detail.trim()) return detail;
  const result = asRecord(record.transactionResult);
  const message = textValue(result?.responseMessage) || textValue(record.title);
  return message || fallback;
}

function payrocProblem(record: Record<string, unknown>, parsed: unknown): GatewayOutcome {
  return {
    kind: 'declined',
    message: payrocInstructionMessage(record, 'Payroc payment failed'),
    response: sanitizeGatewayPayload(parsed),
    details: asRecord(sanitizeGatewayPayload(record)) ?? {},
  };
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

const REDACTED_KEYS = /^(cvv|cvc|cid|pin|pinblock|track1|track2|trackdata|pan|primaryaccountnumber|secret|secretkey|secret_key|security_key|password|apikey|api_key|access_token|refresh_token|authorization|x-api-key)$/i;
const PAN_KEYS = /^(cardnumber|card_number|pan|primaryaccountnumber)$/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  const record = asRecord(value);
  if (!record) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (REDACTED_KEYS.test(key)) continue;
    if (PAN_KEYS.test(key)) {
      sanitized[key] = maskPan(entry);
      continue;
    }
    sanitized[key] = sanitizeValue(entry);
  }
  return sanitized;
}

function maskPan(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  if (text.includes('*')) return text;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return '';
  return `${digits.slice(0, 6)}${'*'.repeat(Math.max(0, digits.length - 10))}${digits.slice(-4)}`;
}

function transportFailure(error: unknown, fallback: string): GatewayOutcome {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error && error.message ? error.message : fallback;
  const uncertain = name === 'AbortError' || name === 'TimeoutError' || /timeout|network|fetch|socket|econn|aborted/i.test(message);
  return { kind: 'failed', statusCode: uncertain ? 504 : 500, message, uncertain };
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
    const raw = await response.text();
    const outcome = interpret(raw);
    if (response.status >= 400 && outcome.kind === 'approved') {
      const parsed = safeJson(raw);
      const record = asRecord(parsed);
      const detail = record?.detail;
      return {
        kind: 'declined',
        message: typeof detail === 'string' && detail.trim() ? detail : fallback,
        response: parsed ?? raw,
      };
    }
    return outcome;
  } catch (error: unknown) {
    return transportFailure(error, fallback);
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

function isPayrocProblem(record: Record<string, unknown>): boolean {
  if (hasPayrocErrors(record.errors)) return true;
  if (typeof record.status === 'number' && record.status >= 400) return true;
  return typeof record.type === 'string' && record.type.includes('docs.payroc.com/api/errors');
}

function safeJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
