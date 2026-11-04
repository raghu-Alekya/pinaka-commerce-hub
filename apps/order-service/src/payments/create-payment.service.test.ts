import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '../entities/order.entity';
import { OrderRepository } from '../order.repository';
import { CreatePaymentService } from './create-payment.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import {
  KICKBACK_SALE_URL,
  PAYROC_API_URL,
  PAYROC_AUTHORIZE_URL,
  chargeKickback,
  chargePayroc,
  interpretKickback,
  interpretPayroc,
  resolvePaymentGateway,
  payrocOrderReference,
  type FetchLike,
  type GatewayOutcome,
} from './payment-gateway';

const orderId = '11111111-1111-4111-8111-111111111111';
const merchantId = '22222222-2222-4222-8222-222222222222';
const storeId = '33333333-3333-4333-8333-333333333333';
const context = { merchantId, storeId, userId: 'user-1' };

function sale(overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    merchant_id: merchantId,
    store_id: storeId,
    client_order_id: '16186',
    device_id: 'device-1',
    currency: 'USD',
    total: '200.00',
    status: 'processing',
    order_status: 'CREATED',
    ...overrides,
  };
}

function kickbackSettings() {
  return {
    payment_gateway_provider: 'kickback',
    providers: [{
      provider: 'Kickback',
      deviceId: 'poi-1',
      processorMerchantId: 'merchant-k',
      terminalId: '',
      secretKey: 'super-secret',
      webhookUrl: 'https://example.test/kickback',
    }],
  };
}

function payrocSettings() {
  return {
    payment_gateway_provider: 'payroc',
    providers: [{
      provider: 'Payroc',
      deviceId: 'SERIAL1',
      processorMerchantId: 'merchant-p',
      terminalId: 'TERM1',
      secretKey: 'payroc-secret',
      webhookUrl: 'https://example.test/payroc',
    }],
  };
}

function harness(options: {
  order?: Record<string, unknown> | null;
  clientOrder?: Record<string, unknown> | null;
  netpay?: unknown;
  config?: unknown;
  payments?: Array<Record<string, unknown>>;
  kickback?: GatewayOutcome;
  payroc?: GatewayOutcome;
  statusError?: Error;
} = {}) {
  const queries: string[] = [];
  const lookupParams: unknown[][] = [];
  const inserts: unknown[][] = [];
  const updates: string[] = [];
  const charges: string[] = [];
  const statusUpdates: unknown[][] = [];
  const service = new CreatePaymentService({
    database: () => ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push(sql);
        if (sql.includes("meta_key = 'new_netpay_amt'")) return [{ meta_value: options.netpay ?? null }];
        if (sql.includes('card_payment_settings')) {
          return options.config === undefined ? [] : [{ configuration_value: options.config }];
        }
        if (sql.includes('INSERT INTO public.store_pos_payments')) {
          inserts.push(params);
          return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
        }
        if (sql.includes('UPDATE public.store_orders')) {
          updates.push(sql);
          return [];
        }
        if (sql.includes('FROM public.store_pos_payments')) return options.payments ?? [];
        if (sql.includes('FROM public.store_orders AS sale')) {
          lookupParams.push(params);
          const clientLookup = sql.includes("'_pos_client_order_id'");
          if (clientLookup) return options.clientOrder ? [options.clientOrder] : [];
          return options.order === null ? [] : [options.order ?? sale()];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    }),
    updateOrderStatus: async (...args: unknown[]) => {
      if (options.statusError) throw options.statusError;
      statusUpdates.push(args);
      return { id: orderId };
    },
  } as unknown as OrderRepository, {
    chargeKickback: async () => {
      charges.push('kickback');
      return options.kickback;
    },
    chargePayroc: async () => {
      charges.push('payroc');
      return options.payroc;
    },
  } as unknown as PaymentGatewayClient);
  return { service, queries, lookupParams, inserts, updates, charges, statusUpdates };
}

function cardBody(amount: number | string = 200, method = 'Card') {
  return { order_id: '16186', amount, payment_method: method, shift_id: 58110 };
}

function assertNoOrderAmountWrite(sql: string) {
  assert.equal(/\b(subtotal|discount_total|tax_total|fee_total|grand_total|line_items|coupon_lines)\b/i.test(sql), false);
  assert.equal(/\bSET\s+total\b/i.test(sql), false);
}

const approvedKickback: GatewayOutcome = {
  kind: 'approved',
  transactionId: 'txn-1',
  details: { response: '1', responsetext: 'Approved', transactionid: 'txn-1', authcode: '42' },
};

test('Kickback approval is saved on the existing payment table and completes the order', async () => {
  const { service, queries, inserts, updates, charges, statusUpdates, lookupParams } = harness({
    config: kickbackSettings(),
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.status, 'success');
  assert.equal(result.payment_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(result.transaction_id, 'txn-1');
  assert.equal(result.order_id, orderId);
  assert.equal(result.paid_amount, 200);
  assert.equal(result.total_paid, 200);
  assert.equal(result.remaining_amount, 0);
  assert.equal(result.order_total, 200);
  assert.equal(result.order_status, 'completed');
  assert.deepEqual(charges, ['kickback']);
  assert.deepEqual(lookupParams[0], [storeId, '16186']);
  assert.equal(inserts.length, 1);
  const params = inserts[0];
  assert.equal(params[0], orderId);
  assert.equal(params[1], merchantId);
  assert.equal(params[2], storeId);
  assert.equal(String(params[3]).startsWith('gateway:'), true);
  assert.equal(params[4], '16186');
  assert.equal(params[5], 'device-1');
  assert.equal(params[6], '58110');
  assert.equal(params[7], 'user-1');
  assert.equal(params[8], 'card');
  assert.equal(params[9], 'Card');
  assert.equal(params[10], 200);
  assert.equal(params[11], 200);
  assert.equal(params[12], 0);
  assert.equal(params[13], 200);
  assert.equal(params[14], 'USD');
  assert.equal(params[15], 'kickback');
  assert.equal(params[16], 'txn-1');
  const metadata = JSON.parse(String(params[17]));
  assert.equal(metadata.payment_status, 'success');
  assert.equal(metadata.void, false);
  assert.equal(metadata.transaction_details.transactionid, 'txn-1');
  assert.equal(metadata.transaction_fields.authcode, '42');
  assert.equal(metadata.transaction_fields.transactionid, undefined);
  assert.equal(JSON.stringify(metadata).includes('super-secret'), false);
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0][0], orderId);
  assert.equal(statusUpdates[0][1], OrderStatus.COMPLETED);
  assert.equal(statusUpdates[0][3], 'Payment completed via POS');
  assert.equal(updates.some((sql) => sql.includes("payment_status = 'PAID'")), true);
  assert.equal(queries.some((sql) => sql.includes("'completed', 'payment', false")), true);
  for (const sql of updates) assertNoOrderAmountWrite(sql);
});

test('Payroc approval is saved against the order, shift, merchant, and store', async () => {
  const { service, inserts, charges } = harness({
    config: payrocSettings(),
    payroc: {
      kind: 'approved',
      transactionId: 'pi_1',
      details: { paymentInstructionId: 'pi_1', status: 'completed' },
    },
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, ['payroc']);
  assert.equal(inserts[0][15], 'payroc');
  assert.equal(inserts[0][16], 'pi_1');
  const metadata = JSON.parse(String(inserts[0][17]));
  assert.equal(metadata.transaction_fields.paymentInstructionId, 'pi_1');
});

test('a Payroc pending body without errors is stored as a successful payment', async () => {
  const { service, inserts, statusUpdates } = harness({
    config: payrocSettings(),
    payroc: {
      kind: 'approved',
      transactionId: 'pi_pending',
      details: { paymentInstructionId: 'pi_pending', status: 'pending' },
    },
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.status, 'success');
  assert.equal(result.transaction_id, 'pi_pending');
  assert.equal(inserts.length, 1);
  assert.equal(statusUpdates.length, 1);
});

test('Kickback decline does not create a payment', async () => {
  const { service, inserts, updates, statusUpdates } = harness({
    config: kickbackSettings(),
    kickback: { kind: 'declined', message: 'Card declined' },
  });
  const result = await service.create(cardBody(), context);
  assert.deepEqual(result, { success: false, status: 'declined', message: 'Card declined' });
  assert.equal(inserts.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(statusUpdates.length, 0);
});

test('Payroc errors are returned without a payment row', async () => {
  const gatewayResponse = { errors: [{ message: 'Do not honor' }] };
  const { service, inserts } = harness({
    config: payrocSettings(),
    payroc: { kind: 'declined', message: 'Payroc payment failed', response: gatewayResponse },
  });
  const result = await service.create(cardBody(), context);
  assert.deepEqual(result, {
    success: false,
    status: 'declined',
    message: 'Payroc payment failed',
    response: gatewayResponse,
  });
  assert.equal(inserts.length, 0);
});

test('a gateway transport failure is an error and saves nothing', async () => {
  const { service, inserts } = harness({
    config: kickbackSettings(),
    kickback: { kind: 'failed', statusCode: 500, message: 'socket hang up' },
  });
  await assert.rejects(
    () => service.create(cardBody(), context),
    (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 500);
      assert.equal(error.message, 'socket hang up');
      return true;
    },
  );
  assert.equal(inserts.length, 0);
});

test('partial payment leaves the order pending and does not recalculate amounts', async () => {
  const { service, inserts, updates, statusUpdates } = harness({
    config: kickbackSettings(),
    payments: [{ id: 'paid-1', amount: '50.00', is_void: false, provider_transaction_id: null }],
    kickback: { ...approvedKickback, transactionId: 'txn-partial' },
  });
  const result = await service.create(cardBody(50), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.paid_amount, 50);
  assert.equal(result.total_paid, 100);
  assert.equal(result.remaining_amount, 100);
  assert.equal(result.order_status, 'pending');
  assert.equal(inserts[0][12], 100);
  assert.equal(statusUpdates.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].includes("status = 'pending'"), true);
  assert.equal(updates[0].includes("payment_status = 'PENDING'"), true);
  assertNoOrderAmountWrite(updates[0]);
});

test('new_netpay_amt is the payable total and a covering payment completes the order', async () => {
  const { service, inserts, statusUpdates } = harness({
    netpay: '150.00',
    config: kickbackSettings(),
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(150), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.order_total, 150);
  assert.equal(result.order_status, 'completed');
  assert.equal(inserts[0][11], 150);
  assert.equal(statusUpdates.length, 1);
});

test('voided payments are excluded from the paid total', async () => {
  const { service } = harness({
    config: kickbackSettings(),
    payments: [{ id: 'voided', amount: '200.00', is_void: true, provider_transaction_id: null }],
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(50), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.total_paid, 50);
  assert.equal(result.remaining_amount, 150);
  assert.equal(result.order_status, 'pending');
});

test('the same gateway transaction is not stored twice', async () => {
  const { service, inserts } = harness({
    config: kickbackSettings(),
    payments: [{ id: 'existing-payment', amount: '200.00', is_void: false, provider_transaction_id: 'txn-1' }],
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.payment_id, 'existing-payment');
  assert.equal(result.total_paid, 200);
  assert.equal(inserts.length, 0);
});

test('cash skips the card gateway and still records the payment', async () => {
  const { service, inserts, charges, queries } = harness({});
  const result = await service.create(cardBody(200, 'Cash'), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.transaction_details, []);
  assert.equal(result.transaction_id, null);
  assert.deepEqual(charges, []);
  assert.equal(queries.some((sql) => sql.includes('card_payment_settings')), false);
  assert.equal(inserts[0][8], 'cash');
  assert.equal(inserts[0][15], null);
});

test('a card payment with no configured gateway is recorded without calling a processor', async () => {
  const { service, inserts, charges } = harness({ config: { providers: [] } });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, []);
  assert.equal(inserts[0][15], null);
});

test('two configured gateways are not guessed and the card payment is still stored', async () => {
  const { service, inserts, charges } = harness({
    config: {
      cardPayments: [
        { provider: 'Payroc', deviceId: 'b', secretKey: 'p', processorMerchantId: '2', terminalId: 't', webhookUrl: 'https://example.test/p' },
        { provider: 'Kickback', deviceId: 'a', secretKey: 'k', processorMerchantId: '1', terminalId: '', webhookUrl: 'https://example.test/k' },
      ],
    },
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, []);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][15], null);
});

test('a cardPayments entry is charged when the request names that provider', async () => {
  const { service, inserts, charges } = harness({
    config: {
      cardPayments: [
        { provider: 'Payroc', deviceId: 'serial', secretKey: 'payroc-secret', processorMerchantId: '6562', terminalId: '6562001', webhookUrl: 'https://example.test/p' },
        { provider: 'Kickback', deviceId: 'poi', secretKey: 'kick-secret', processorMerchantId: 'Alekta', terminalId: '', webhookUrl: 'https://example.test/k' },
      ],
    },
    payroc: { kind: 'approved', transactionId: 'pi_saved', details: { paymentInstructionId: 'pi_saved', status: 'approved' } },
  });
  const result = await service.create({ ...cardBody(), provider: 'Payroc' }, context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.transaction_id, 'pi_saved');
  assert.deepEqual(charges, ['payroc']);
  assert.equal(inserts[0][15], 'payroc');
  assert.equal(inserts[0][16], 'pi_saved');
});

test('one saved cardPayments gateway is used for the card sale', async () => {
  const { service, inserts, charges } = harness({
    config: { cardPayments: [kickbackSettings().providers[0]] },
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, ['kickback']);
  assert.equal(inserts[0][15], 'kickback');
  assert.equal(inserts[0][16], 'txn-1');
});

test('payment_gateway_provider payrock selects Payroc', async () => {
  const { service, charges } = harness({
    config: {
      payment_gateway_provider: 'payrock',
      providers: [
        kickbackSettings().providers[0],
        payrocSettings().providers[0],
      ],
    },
    payroc: { kind: 'approved', transactionId: 'pi_2', details: { paymentInstructionId: 'pi_2' } },
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, ['payroc']);
});

test('an offline provider selection records the card payment locally', async () => {
  const { service, charges, inserts } = harness({
    config: { payment_gateway_provider: 'default', providers: [kickbackSettings().providers[0]] },
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  assert.deepEqual(charges, []);
  assert.equal(inserts[0][15], null);
});

test('validation matches the WordPress required fields', async () => {
  const { service, queries } = harness();
  await assert.rejects(
    () => service.create({ amount: 10, payment_method: 'Card', shift_id: '58110' }, context),
    (error: unknown) => error instanceof BadRequestException && error.message.includes('Order ID'),
  );
  await assert.rejects(
    () => service.create({ order_id: '16186', payment_method: 'Card', shift_id: '58110' }, context),
    (error: unknown) => error instanceof BadRequestException,
  );
  await assert.rejects(
    () => service.create({ order_id: '16186', amount: 10, payment_method: 'Card' }, context),
    (error: unknown) => error instanceof BadRequestException && error.message === 'Shift ID is required',
  );
  await assert.rejects(
    () => service.create({ order_id: '16186', amount: -1, payment_method: 'Card', shift_id: '58110' }, context),
    (error: unknown) => error instanceof BadRequestException && error.message === 'amount must be zero or greater',
  );
  assert.equal(queries.length, 0);
});

test('a _pos_client_order_id resolves to the internal order used by the payment', async () => {
  const clientOrderId = '59dd2e9b-3851-4aab-99ff-f4034a9ca896';
  const { service, inserts, charges, lookupParams } = harness({
    order: null,
    clientOrder: sale({ client_order_id: clientOrderId }),
    config: kickbackSettings(),
    kickback: approvedKickback,
  });
  const result = await service.create({ ...cardBody(), order_id: clientOrderId }, context);
  assert.equal(result.success, true);
  assert.equal(lookupParams.length, 2);
  assert.deepEqual(lookupParams[0], [storeId, clientOrderId]);
  assert.deepEqual(lookupParams[1], [storeId, clientOrderId]);
  assert.equal(inserts[0][0], orderId);
  assert.equal(inserts[0][4], clientOrderId);
  assert.notEqual(inserts[0][0], clientOrderId);
  assert.deepEqual(charges, ['kickback']);
});

test('an order saved under another merchant is found by the store', async () => {
  const orderMerchant = '44444444-4444-4444-8444-444444444444';
  const { service, inserts, charges } = harness({
    order: sale({ merchant_id: orderMerchant, client_order_id: '2629333373' }),
    config: kickbackSettings(),
    kickback: approvedKickback,
  });
  const result = await service.create({ ...cardBody(), order_id: '2629333373' }, context);
  assert.equal(result.success, true);
  assert.equal(inserts[0][1], orderMerchant);
  assert.notEqual(inserts[0][1], merchantId);
  assert.deepEqual(charges, ['kickback']);
});

test('an unknown order is rejected before a gateway charge', async () => {
  const { service, charges, inserts } = harness({ order: null, config: kickbackSettings() });
  await assert.rejects(
    () => service.create(cardBody(), context),
    (error: unknown) => error instanceof NotFoundException && error.message === 'Invalid order ID',
  );
  assert.deepEqual(charges, []);
  assert.equal(inserts.length, 0);
});

test('a cancelled order keeps its status while the captured payment is saved', async () => {
  const { service, inserts, updates, statusUpdates } = harness({
    order: sale({ order_status: 'CANCELLED', status: 'cancelled' }),
    config: kickbackSettings(),
    kickback: approvedKickback,
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.order_status, 'cancelled');
  assert.equal(inserts.length, 1);
  assert.equal(updates.length, 0);
  assert.equal(statusUpdates.length, 0);
});

test('a status conflict after capture still returns the saved payment', async () => {
  const { service, inserts, updates } = harness({
    config: kickbackSettings(),
    kickback: approvedKickback,
    statusError: new ConflictException('Cancelled orders cannot change status'),
  });
  const result = await service.create(cardBody(), context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.order_status, 'processing');
  assert.equal(inserts.length, 1);
  assert.equal(updates.some((sql) => sql.includes("payment_status = 'PAID'")), false);
});

test('Kickback response handling matches WordPress', () => {
  const approved = interpretKickback('response=1&responsetext=Approved&transactionid=abc&authcode=42');
  assert.equal(approved.kind, 'approved');
  if (approved.kind !== 'approved') return;
  assert.equal(approved.transactionId, 'abc');
  const declined = interpretKickback('response=2&responsetext=Card declined');
  assert.deepEqual(declined, { kind: 'declined', message: 'Card declined' });
  const pending = interpretKickback('response=3&responsetext=Pending');
  assert.deepEqual(pending, { kind: 'declined', message: 'Pending' });
});

test('Payroc pending without errors is approved and an errors payload is declined', () => {
  const pending = interpretPayroc(JSON.stringify({ paymentInstructionId: 'pi_9', status: 'pending' }));
  assert.equal(pending.kind, 'approved');
  const inProgress = interpretPayroc(JSON.stringify({ paymentInstructionId: 'pi_8', status: 'inProgress' }));
  assert.equal(inProgress.kind, 'approved');
  const declined = interpretPayroc(JSON.stringify({ errors: [{ message: 'Declined' }] }));
  assert.equal(declined.kind, 'declined');
  if (declined.kind !== 'declined') return;
  assert.equal(declined.message, 'Payroc payment failed');
  assert.deepEqual(declined.response, { errors: [{ message: 'Declined' }] });
});

test('gateway selection uses the saved card payment settings', () => {
  const offline = resolvePaymentGateway(null);
  assert.equal(offline.ok, true);
  if (offline.ok) assert.equal(offline.gateway, 'offline');
  const single = resolvePaymentGateway(kickbackSettings());
  assert.equal(single.ok, true);
  if (single.ok) assert.equal(single.gateway, 'kickback');
  const credentialsOnly = resolvePaymentGateway({ cardPayments: [kickbackSettings().providers[0]] });
  assert.equal(credentialsOnly.ok, true);
  if (credentialsOnly.ok) assert.equal(credentialsOnly.gateway, 'kickback');
  const storedShape = resolvePaymentGateway({
    cardPayments: [payrocSettings().providers[0], kickbackSettings().providers[0]],
  }, 'Payroc');
  assert.equal(storedShape.ok, true);
  if (storedShape.ok) assert.equal(storedShape.gateway, 'payroc');
  const ambiguous = resolvePaymentGateway({
    cardPayments: [kickbackSettings().providers[0], payrocSettings().providers[0]],
  });
  assert.equal(ambiguous.ok, true);
  if (ambiguous.ok) assert.equal(ambiguous.gateway, 'offline');
  const selected = resolvePaymentGateway({
    payment_gateway_provider: 'payrock',
    providers: [kickbackSettings().providers[0], payrocSettings().providers[0]],
  });
  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.gateway, 'payroc');
  const legacyProviders = resolvePaymentGateway({
    providers: [kickbackSettings().providers[0], payrocSettings().providers[0]],
  });
  assert.equal(legacyProviders.ok, true);
  if (legacyProviders.ok) assert.equal(legacyProviders.gateway, 'offline');
});

test('Kickback sale posts the WordPress request', async () => {
  let seen: { url: string; body: string } | undefined;
  const fetchImpl: FetchLike = async (url, init) => {
    seen = { url: String(url), body: String(init?.body) };
    return new Response('response=1&responsetext=Approved&transactionid=abc123&authcode=42');
  };
  const result = await chargeKickback({ deviceId: 'dev-1', secretKey: 'sec', amount: 200 }, fetchImpl);
  assert.equal(result.kind, 'approved');
  assert.equal(seen?.url, KICKBACK_SALE_URL);
  const params = new URLSearchParams(seen?.body);
  assert.equal(params.get('security_key'), 'sec');
  assert.equal(params.get('type'), 'sale');
  assert.equal(params.get('amount'), '200.00');
  assert.equal(params.get('poi_device_id'), 'dev-1');
  assert.equal(params.get('response_method'), 'synchronous');
});

test('Payroc orderId stays within 1 to 24 characters', () => {
  assert.equal(
    payrocOrderReference('2629333374', '6d9306b1-74ea-4e30-b527-840a2c6b116f'),
    '2629333374',
  );
  const fromInternal = payrocOrderReference('6d9306b1-74ea-4e30-b527-840a2c6b116f', '2629333374');
  assert.equal(fromInternal, '2629333374');
  assert.equal(payrocOrderReference(orderId).length <= 24, true);
});

test('Payroc sale posts the WordPress request and reuses the token', async () => {
  const calls: string[] = [];
  const tokens = new Map<string, { token: string; expiresAt: number }>();
  const fetchImpl: FetchLike = async (url, init) => {
    const target = String(url);
    calls.push(target);
    if (target === PAYROC_AUTHORIZE_URL) {
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'secret');
      return new Response(JSON.stringify({ access_token: 'tok' }));
    }
    const body = JSON.parse(String(init?.body));
    const gatewayOrderId = payrocOrderReference(orderId);
    assert.equal(target, `${PAYROC_API_URL}/v1/devices/SERIAL1/payment-instructions`);
    assert.equal(body.processingTerminalId, 'TERM1');
    assert.equal(body.operator, 'user-7');
    assert.equal(body.order.orderId, gatewayOrderId);
    assert.equal(gatewayOrderId.length <= 24, true);
    assert.equal(body.order.description, `WooCommerce Order #${gatewayOrderId}`);
    assert.equal(body.order.currency, 'USD');
    assert.equal(body.order.amount, 20000);
    assert.equal(body.autoCapture, true);
    assert.equal(body.processAsSale, false);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer tok');
    assert.match(headers.get('idempotency-key') || '', /^[0-9a-f-]{36}$/i);
    return new Response(JSON.stringify({ paymentInstructionId: 'pi_1', status: 'pending' }));
  };
  const input = {
    deviceId: 'SERIAL1', terminalId: 'TERM1', secretKey: 'secret', amount: 200, orderId, operator: 'user-7',
  };
  const first = await chargePayroc(input, fetchImpl, tokens);
  const second = await chargePayroc(input, fetchImpl, tokens);
  assert.equal(first.kind, 'approved');
  assert.equal(second.kind, 'approved');
  assert.deepEqual(calls, [
    PAYROC_AUTHORIZE_URL,
    `${PAYROC_API_URL}/v1/devices/SERIAL1/payment-instructions`,
    `${PAYROC_API_URL}/v1/devices/SERIAL1/payment-instructions`,
  ]);
});

test('Payroc token failure and Kickback transport failure do not look successful', async () => {
  const token = await chargePayroc({
    deviceId: 'SERIAL1', terminalId: 'TERM1', secretKey: 'missing', amount: 10, orderId, operator: 'user-7',
  }, async () => new Response('{}'), new Map());
  assert.deepEqual(token, { kind: 'failed', statusCode: 500, message: 'Unable to obtain Payroc token' });
  const transport = await chargeKickback(
    { deviceId: 'dev-1', secretKey: 'sec', amount: 10 },
    async () => { throw new Error('network down'); },
  );
  assert.equal(transport.kind, 'failed');
  if (transport.kind !== 'failed') return;
  assert.equal(transport.message, 'network down');
});
