import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { OrderStatus } from '../entities/order.entity';
import { OrderRepository } from '../order.repository';
import { PaymentGatewayClient } from './payment-gateway.client';
import { logPayrocPayment } from './payment-log';
import {
  isPhpEmpty,
  payrocCardTerminalDeviceId,
  payrocIdempotencyKey,
  payrocOrderReference,
  readPaymentAmount,
  readPosDeviceId,
  resolvePaymentGateway,
  sanitizeGatewayPayload,
  transactionFields,
  type GatewayCredentials,
  type GatewayName,
  type GatewayOutcome,
} from './payment-gateway';

export interface CreatePaymentContext {
  merchantId: string;
  storeId: string;
  userId: string;
  idempotencyKey?: string;
}

export interface CreatePaymentSuccess {
  success: true;
  status: 'success';
  message: 'Payment successful';
  payment_id: string;
  transaction_id: string | null;
  transaction_details: Record<string, unknown> | unknown[];
  order_id: string;
  paid_amount: number;
  total_paid: number;
  remaining_amount: number;
  order_total: number;
  order_status: string;
}

export interface CreatePaymentDecline {
  success: false;
  status: 'declined';
  message: string;
  response?: unknown;
}

export interface CreatePaymentPending {
  success: false;
  status: 'pending';
  message: string;
  payment_id: string;
  transaction_id: string | null;
  local_id: string;
}

interface SaleRow {
  order_id: string;
  merchant_id: string;
  store_id: string;
  client_order_id: string | null;
  device_id: string | null;
  currency: string | null;
  total: string | number;
  status: string | null;
  order_status: string | null;
  request_payload?: unknown;
}

interface TenderInput {
  order: SaleRow;
  shiftId: string;
  userId: string;
  paymentMethod: string;
  paymentMethodTitle: string;
  amount: number;
  requestedOrderId: string;
}

interface PaymentRow {
  id: string;
  amount: string | number;
  is_void: boolean;
  provider_transaction_id: string | null;
  local_id?: string | null;
  status?: string | null;
  metadata?: unknown;
  provider?: string | null;
  payment_method?: string | null;
  payment_gateway_response?: unknown;
  order_id?: string;
  merchant_id?: string;
  store_id?: string;
  shift_id?: string | null;
  user_id?: string | null;
  currency?: string | null;
  order_total?: string | number;
}

@Injectable()
export class CreatePaymentService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(PaymentGatewayClient) private readonly gateways: PaymentGatewayClient,
  ) {}

  async create(
    body: Record<string, unknown>,
    context: CreatePaymentContext,
  ): Promise<CreatePaymentSuccess | CreatePaymentDecline | CreatePaymentPending> {
    const amount = readPaymentAmount(body.amount);
    if (isPhpEmpty(body.order_id) || amount === undefined || Number.isNaN(amount) || isPhpEmpty(body.payment_method)) {
      throw new BadRequestException('Order ID, amount, and payment method are required');
    }
    if (isPhpEmpty(body.shift_id)) throw new BadRequestException('Shift ID is required');
    if (amount < 0) throw new BadRequestException('amount must be zero or greater');

    const paymentMethodRaw = String(body.payment_method);
    const paymentMethod = paymentMethodRaw.trim().toLowerCase();
    const shiftId = String(body.shift_id).trim().slice(0, 150);
    const order = await this.findOrder(context, String(body.order_id).trim());
    if (!order) throw new NotFoundException('Invalid order ID');
    const tender = {
      order,
      shiftId,
      userId: context.userId.slice(0, 150),
      paymentMethod,
      paymentMethodTitle: paymentMethodRaw.trim().slice(0, 150) || paymentMethod,
      amount,
      requestedOrderId: String(body.order_id).trim(),
    };

    if (paymentMethod !== 'card' && !isEbtMethod(paymentMethod)) {
      return this.recordCaptured(tender, { provider: null, transactionId: '', details: null });
    }
    return this.captureCard(tender, context, body);
  }

  /**
   * One card attempt is one store_pos_payments row. The row is inserted before
   * the processor call and updated with the gateway result. The same local_id
   * resumes that row. Payroc retries reuse the original Idempotency-Key.
   * Kickback is not submitted again after the first request left this service.
   */
  private async captureCard(
    tender: TenderInput,
    context: CreatePaymentContext,
    body: Record<string, unknown>,
  ): Promise<CreatePaymentSuccess | CreatePaymentDecline | CreatePaymentPending> {
    const configuration = await this.gatewayConfiguration(context.storeId);
    const requested = body.payment_gateway_provider ?? body.pinaka_payment_gateway_provider ?? body.provider;
    const resolved = resolvePaymentGateway(configuration, requested);
    if (!resolved.ok) throw new BadRequestException(resolved.message);
    if (resolved.gateway === 'offline') {
      return this.recordCaptured(tender, { provider: null, transactionId: '', details: null });
    }
    const credentials = resolved.gateway === 'payroc' && !isEbtMethod(tender.paymentMethod)
      ? this.payrocCredentialsForOrder(tender, configuration, resolved.credentials)
      : resolved.credentials;

    const localId = attemptLocalId(body, context.idempotencyKey);
    const payable = await this.payableTotal(tender.order);
    const existing = await this.listPayments(tender.order.order_id);
    // The order save writes a second card row titled POS-CARD. Reuse that row,
    // or the row already charged for this amount, instead of inserting another.
    let attempt = existing.find((row) => row.local_id === localId)
      ?? adoptableCardPayment(existing, tender.amount, tender.paymentMethod);
    const capturedBefore = paidTotal(existing.filter((row) => row.id !== attempt?.id));
    if (attempt && countsAsCaptured(attempt) && hasGatewayResult(attempt)) {
      await this.collapseDuplicateCardTenders(tender.order.order_id, tender.amount, tender.paymentMethod);
      const totalPaid = paidTotal(existing);
      const fullyPaid = Math.round(totalPaid * 100) >= Math.round(payable * 100);
      const orderStatus = await this.applyOrderStatus(tender.order, fullyPaid, tender.userId);
      const details = asRecord(metadataRecord(attempt.metadata).transaction_details);
      return this.successBody(
        tender,
        attempt.id,
        attempt.provider_transaction_id || '',
        details,
        totalPaid,
        Math.max(0, money(payable - totalPaid)),
        payable,
        orderStatus,
      );
    }
    if (attempt && resolved.gateway === 'kickback' && gatewayAlreadySubmitted(attempt)) {
      await this.collapseDuplicateCardTenders(tender.order.order_id, tender.amount, tender.paymentMethod);
      return this.storedGatewayResponse(tender, attempt, payable, capturedBefore);
    }

    if (!attempt) {
      const remaining = Math.max(0, money(payable - capturedBefore));
      const paymentId = await this.insertPayment({
        ...tender,
        payable,
        remaining,
        refundable: tender.amount,
        provider: resolved.gateway,
        transactionId: '',
        status: 'pending',
        localId,
        metadata: this.attemptMetadata(tender, resolved.gateway, credentials, localId, {
          payment_status: 'pending',
          gateway_submitted: resolved.gateway === 'kickback',
        }),
        gatewayResponse: null,
      });
      attempt = {
        id: paymentId,
        amount: tender.amount,
        is_void: false,
        provider_transaction_id: null,
        local_id: localId,
        status: 'pending',
        provider: resolved.gateway,
        metadata: { gateway_submitted: resolved.gateway === 'kickback' },
      };
    }

    const outcome = await this.submitCard(tender, context, body, resolved.gateway, credentials, attempt);
    return this.applyGatewayOutcome(tender, attempt, payable, capturedBefore, resolved.gateway, credentials, localId, outcome);
  }

  /**
   * Payroc calls this after the device finishes. The body is not trusted:
   * the stored attempt is updated only from a live Payroc read. Unknown
   * attempts are not inserted.
   */
  async applyPayrocWebhook(body: Record<string, unknown>): Promise<{ success: true; payment_id: string; status: string }> {
    const ids = gatewayReferenceIds(body);
    if (!ids.length) throw new BadRequestException('Payroc payment identifier is required');
    const payment = await this.findGatewayPayment(ids);
    if (!payment?.id || !payment.store_id || !payment.order_id) {
      throw new NotFoundException('Payment attempt was not found');
    }
    if (countsAsCaptured(payment)) {
      return { success: true, payment_id: payment.id, status: 'completed' };
    }
    const configuration = await this.gatewayConfiguration(payment.store_id);
    const resolved = resolvePaymentGateway(configuration, 'payroc');
    if (!resolved.ok || resolved.gateway !== 'payroc') {
      throw new BadRequestException(resolved.ok ? 'Payroc is not the active card gateway' : resolved.message);
    }
    const instructionId = textOf(metadataRecord(payment.metadata).payment_instruction_id)
      || ids.find((id) => /^[0-9a-f]{32}$/i.test(id))
      || '';
    const paymentId = ids.find((id) => id !== instructionId) || '';
    const outcome = await this.gateways.continuePayroc({
      secretKey: resolved.credentials.secretKey,
      ...(instructionId ? { instructionId } : {}),
      ...(paymentId ? { paymentId } : {}),
    });
    if (outcome.kind === 'failed' && countsAsCaptured(payment)) {
      return { success: true, payment_id: payment.id, status: 'completed' };
    }
    const order = await this.findOrderById(payment.order_id);
    if (!order) throw new NotFoundException('Payment attempt was not found');
    const tender: TenderInput = {
      order,
      shiftId: String(payment.shift_id || '').slice(0, 150),
      userId: String(payment.user_id || 'POS System').slice(0, 150),
      paymentMethod: isEbtMethod(payment.payment_method) ? normalizeTender(payment.payment_method) : 'card',
      paymentMethodTitle: isEbtMethod(payment.payment_method) ? normalizeTender(payment.payment_method) : 'Card',
      amount: numberValue(payment.amount),
      requestedOrderId: String(payment.local_id || payment.order_id),
    };
    const existing = await this.listPayments(order.order_id);
    const capturedBefore = paidTotal(existing.filter((row) => row.id !== payment.id));
    const applied = await this.applyGatewayOutcome(
      tender,
      payment,
      await this.payableTotal(order),
      capturedBefore,
      'payroc',
      resolved.credentials,
      String(payment.local_id || payment.id),
      outcome,
    );
    return {
      success: true,
      payment_id: payment.id,
      status: applied.status === 'success' ? 'completed' : applied.status,
    };
  }

  private async recordCaptured(
    tender: TenderInput,
    gateway: { provider: string | null; transactionId: string; details: Record<string, unknown> | null },
  ): Promise<CreatePaymentSuccess> {
    const payable = await this.payableTotal(tender.order);
    const existing = await this.listPayments(tender.order.order_id);
    const replay = gateway.transactionId
      ? existing.find((row) => row.provider_transaction_id === gateway.transactionId && countsAsCaptured(row))
      : undefined;
    const totalPaid = paidTotal(replay
      ? existing
      : [...existing, { id: '', amount: tender.amount, is_void: false, provider_transaction_id: gateway.transactionId || null, status: 'completed' }]);
    const remaining = Math.max(0, money(payable - totalPaid));
    const paymentId = replay
      ? replay.id
      : await this.insertPayment({
        ...tender,
        payable,
        remaining,
        refundable: tender.amount,
        provider: gateway.provider,
        transactionId: gateway.transactionId,
        status: 'completed',
        localId: `gateway:${randomUUID()}`,
        metadata: this.attemptMetadata(tender, gateway.provider, null, '', {
          payment_status: 'success',
          gateway_submitted: false,
          transaction_details: gateway.details ?? {},
          transaction_fields: transactionFields(gateway.details ?? {}),
        }),
        gatewayResponse: gateway.provider ? gatewayResponseDocument(gateway.details) : null,
      });
    const fullyPaid = Math.round(totalPaid * 100) >= Math.round(payable * 100);
    const orderStatus = await this.applyOrderStatus(tender.order, fullyPaid, tender.userId);
    return this.successBody(tender, paymentId, gateway.transactionId, gateway.details, totalPaid, remaining, payable, orderStatus);
  }

  private async submitCard(
    tender: TenderInput,
    context: CreatePaymentContext,
    body: Record<string, unknown>,
    gateway: GatewayName,
    credentials: GatewayCredentials,
    attempt: PaymentRow,
  ): Promise<GatewayOutcome> {
    if (gateway === 'kickback') {
      return this.gateways.chargeKickback({
        deviceId: credentials.deviceId,
        secretKey: credentials.secretKey,
        amount: tender.amount,
      });
    }
    const localId = String(attempt.local_id || '');
    const instructionId = textOf(attempt.provider_transaction_id)
      || textOf(metadataRecord(attempt.metadata).payment_instruction_id);
    if (instructionId && gatewayAlreadySubmitted(attempt)) {
      return this.gateways.continuePayroc({
        secretKey: credentials.secretKey,
        instructionId,
      });
    }
    logPayrocPayment('payroc_submit', {
      orderId: tender.order.order_id,
      storeId: tender.order.store_id,
      cardTerminalDeviceId: credentials.deviceId,
      terminalId: credentials.terminalId,
    });
    return this.gateways.chargePayroc({
      deviceId: credentials.deviceId,
      terminalId: credentials.terminalId,
      secretKey: credentials.secretKey,
      processorMerchantId: credentials.processorMerchantId,
      amount: tender.amount,
      currency: String(tender.order.currency || 'USD'),
      orderId: payrocOrderReference(body.order_id, tender.order.client_order_id, tender.order.order_id),
      operator: context.userId,
      idempotencyKey: payrocIdempotencyKey(`${tender.order.order_id}:${localId}`),
    });
  }

  private async applyGatewayOutcome(
    tender: TenderInput,
    attempt: PaymentRow,
    payable: number,
    capturedBefore: number,
    gateway: GatewayName,
    credentials: GatewayCredentials | null,
    localId: string,
    outcome: GatewayOutcome,
  ): Promise<CreatePaymentSuccess | CreatePaymentDecline | CreatePaymentPending> {
    const uncertain = outcome.kind === 'failed' && (
      outcome.uncertain === true
      || outcome.statusCode === 504
      || /timeout|socket|network|aborted|econn|fetch failed/i.test(outcome.message)
    );
    const approved = outcome.kind === 'approved';
    const pending = outcome.kind === 'pending' || uncertain;
    const status = approved ? 'completed' : pending ? 'pending' : 'failed';
    const transactionId = outcome.kind === 'failed' ? '' : outcome.transactionId || '';
    const details = outcome.kind === 'failed' ? outcome.details ?? null : outcome.kind === 'declined' ? outcome.details ?? null : outcome.details;
    const totalPaid = money(capturedBefore + (approved ? tender.amount : 0));
    const remaining = Math.max(0, money(payable - totalPaid));
    const facts = gatewayFacts(details);
    const metadata = this.attemptMetadata(tender, gateway, credentials, localId, {
      payment_status: approved ? 'success' : pending ? 'pending' : outcome.kind === 'declined' ? 'declined' : 'failed',
      gateway_submitted: outcome.kind === 'failed' ? outcome.uncertain === true : true,
      uncertain,
      gateway_transaction_id: transactionId || facts.instructionId,
      payment_instruction_id: facts.instructionId,
      gateway_status: facts.status,
      gateway_response_code: facts.code,
      gateway_response_message: facts.message,
      transaction_at: facts.at,
      failure_reason: approved ? '' : outcome.kind === 'pending' ? '' : outcome.message,
      transaction_details: details ?? {},
      transaction_fields: transactionFields(asRecord(details) ?? {}),
      gateway_request: asRecord(details)?.gateway_request,
      gateway_response: asRecord(details)?.gateway_response ?? details ?? {},
      instruction: asRecord(details)?.instruction,
    });
    const gatewayResponse = gatewayResponseDocument(details) ?? (
      outcome.kind === 'approved' || outcome.kind === 'pending'
        ? null
        : {
            status: outcome.kind,
            message: outcome.message,
            ...(outcome.kind === 'declined' && outcome.response !== undefined ? { response: outcome.response } : {}),
          }
    );
    await this.updatePayment({
      id: attempt.id,
      status,
      provider: gateway,
      transactionId: transactionId || facts.instructionId,
      metadata,
      remaining,
      refundable: tender.amount,
      paymentAt: facts.at,
      gatewayResponse,
    });
    await this.collapseDuplicateCardTenders(tender.order.order_id, tender.amount, tender.paymentMethod);
    if (approved) {
      const fullyPaid = Math.round(totalPaid * 100) >= Math.round(payable * 100);
      const orderStatus = await this.applyOrderStatus(tender.order, fullyPaid, tender.userId);
      return this.successBody(tender, attempt.id, transactionId, details, totalPaid, remaining, payable, orderStatus);
    }
    if (pending) {
      const message = outcome.kind === 'failed' ? outcome.message : outcome.kind === 'pending' ? outcome.message : 'Payment is in progress';
      return {
        success: false,
        status: 'pending',
        message,
        payment_id: attempt.id,
        transaction_id: transactionId || null,
        local_id: localId,
      };
    }
    if (outcome.kind === 'declined') {
      console.error(`[Payment] ${gateway} declined for order ${tender.order.order_id}: ${outcome.message}`);
      return declineBody(outcome);
    }
    throw new HttpException(outcome.message, outcome.statusCode);
  }

  private storedGatewayResponse(
    tender: TenderInput,
    attempt: PaymentRow,
    payable: number,
    capturedBefore: number,
  ): CreatePaymentDecline | CreatePaymentPending {
    const metadata = metadataRecord(attempt.metadata);
    const remaining = Math.max(0, money(payable - capturedBefore));
    if (String(attempt.status || '').toLowerCase() === 'pending' || metadata.uncertain === true) {
      return {
        success: false,
        status: 'pending',
        message: textOf(metadata.failure_reason) || textOf(metadata.gateway_response_message) || 'Payment is in progress',
        payment_id: attempt.id,
        transaction_id: attempt.provider_transaction_id,
        local_id: String(attempt.local_id || ''),
      };
    }
    void remaining;
    return {
      success: false,
      status: 'declined',
      message: textOf(metadata.failure_reason) || textOf(metadata.gateway_response_message) || 'Card declined',
      ...(metadata.gateway_response !== undefined ? { response: metadata.gateway_response } : {}),
    };
  }

  private successBody(
    tender: TenderInput,
    paymentId: string,
    transactionId: string,
    details: Record<string, unknown> | null,
    totalPaid: number,
    remaining: number,
    payable: number,
    orderStatus: string,
  ): CreatePaymentSuccess {
    return {
      success: true,
      status: 'success',
      message: 'Payment successful',
      payment_id: paymentId,
      transaction_id: transactionId || null,
      transaction_details: details ?? [],
      order_id: tender.order.order_id,
      paid_amount: tender.amount,
      total_paid: totalPaid,
      remaining_amount: remaining,
      order_total: payable,
      order_status: orderStatus,
    };
  }

  private attemptMetadata(
    tender: TenderInput,
    provider: string | null,
    credentials: GatewayCredentials | null,
    localId: string,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    const deviceId = tender.order.device_id?.trim() ? tender.order.device_id.trim() : '';
    return sanitizeGatewayPayload({
      source: 'api/v1/payments/create-payment',
      provider,
      payment_method: tender.paymentMethod,
      void: false,
      attempt_id: localId,
      gateway_device_id: credentials?.deviceId || undefined,
      terminal_id: credentials?.terminalId || undefined,
      processor_merchant_id: credentials?.processorMerchantId || undefined,
      ...(deviceId ? {} : { device_id_missing_source: true }),
      source_payload: {
        order_id: tender.requestedOrderId,
        amount: tender.amount,
        payment_method: tender.paymentMethod,
        shift_id: tender.shiftId,
      },
      ...extra,
    }) as Record<string, unknown>;
  }

  private async findOrder(context: CreatePaymentContext, orderKey: string): Promise<SaleRow | null> {
    // Order reads are store-scoped. The saved order merchant can differ from
    // the POS x-merchant-id header, so the header is not a match condition.
    const params = [context.storeId, orderKey];
    const internal = await this.query<SaleRow>(
      `${ORDER_LOOKUP_SELECT}
        WHERE sale.store_id = $1::uuid
          AND (
            sale.order_id::text = $2
            OR sale.id::text = $2
            OR sale.client_order_id = $2
            OR sale.order_number = $2
            OR sale.order_number = '#' || $2
          )
        ORDER BY sale.created_at DESC
        LIMIT 1`,
      params,
    );
    if (internal[0]) return internal[0];
    // POS sends _pos_client_order_id when that value was not copied onto
    // store_orders.client_order_id. The payment still uses sale.order_id.
    const byClientOrder = await this.query<SaleRow>(
      `${ORDER_LOOKUP_SELECT}
        WHERE sale.store_id = $1::uuid
          AND (
            EXISTS (
              SELECT 1
                FROM public.store_orders_meta AS meta
               WHERE meta.order_id = sale.order_id
                 AND meta.meta_key = '_pos_client_order_id'
                 AND btrim(COALESCE(meta.meta_value #>> '{}', ''), '"') = $2
            )
            OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(sale.meta_data) = 'array' THEN sale.meta_data ELSE '[]'::jsonb END
                  || CASE WHEN jsonb_typeof(sale.request_payload->'meta_data') = 'array'
                       THEN sale.request_payload->'meta_data' ELSE '[]'::jsonb END
                ) AS entry
               WHERE entry->>'key' = '_pos_client_order_id'
                 AND btrim(COALESCE(entry->>'value', ''), '"') = $2
            )
          )
        ORDER BY sale.created_at DESC
        LIMIT 1`,
      params,
    );
    return byClientOrder[0] ?? null;
  }

  /** Card sales use the Payroc terminal mapped to this order's POS device. EBT keeps the stored device id. */
  private payrocCredentialsForOrder(
    tender: TenderInput,
    configuration: unknown,
    credentials: GatewayCredentials,
  ): GatewayCredentials {
    const posDevice = readPosDeviceId(tender.order.request_payload);
    if (!posDevice.ok) {
      logPayrocPayment('mapping_error', {
        orderId: tender.order.order_id,
        storeId: tender.order.store_id,
        message: posDevice.message,
      });
      throw new BadRequestException(posDevice.message);
    }
    const mapped = payrocCardTerminalDeviceId(configuration, posDevice.posDeviceId);
    if (!mapped.ok) {
      logPayrocPayment('mapping_error', {
        orderId: tender.order.order_id,
        storeId: tender.order.store_id,
        posDeviceId: posDevice.posDeviceId,
        message: mapped.message,
      });
      throw new BadRequestException(mapped.message);
    }
    logPayrocPayment('terminal_mapped', {
      orderId: tender.order.order_id,
      storeId: tender.order.store_id,
      posDeviceId: posDevice.posDeviceId,
      cardTerminalDeviceId: mapped.cardTerminalDeviceId,
    });
    return { ...credentials, deviceId: mapped.cardTerminalDeviceId };
  }

  private async gatewayConfiguration(storeId: string): Promise<unknown> {
    const rows = await this.query<{ configuration_value: unknown }>(
      `SELECT configuration_value
         FROM public.store_pos_configurations
        WHERE store_id = $1::uuid
          AND configuration_name = 'card_payment_settings'
        LIMIT 1`,
      [storeId],
    );
    return rows[0]?.configuration_value ?? null;
  }

  /**
   * WordPress replaces the order total with new_netpay_amt when that meta exists.
   * The stored order total, tax, and discounts are not recalculated.
   */
  private async payableTotal(order: SaleRow): Promise<number> {
    const rows = await this.query<{ meta_value: unknown }>(
      `SELECT COALESCE(
          (SELECT meta_value
             FROM public.store_orders_meta
            WHERE order_id = $1::uuid AND meta_key = 'new_netpay_amt'
            LIMIT 1),
          (SELECT entry->'value'
             FROM public.store_orders AS sale
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(sale.meta_data) = 'array' THEN sale.meta_data
                 ELSE '[]'::jsonb
               END
             ) AS entry
            WHERE sale.order_id = $1::uuid
              AND entry->>'key' = 'new_netpay_amt'
            LIMIT 1)
        ) AS meta_value`,
      [order.order_id],
    );
    const meta = rows[0]?.meta_value;
    if (meta == null || meta === '') return money(numberValue(order.total));
    return money(numberValue(meta));
  }

  private async listPayments(orderId: string): Promise<PaymentRow[]> {
    return this.query<PaymentRow>(
      `SELECT id::text AS id, amount, is_void, provider_transaction_id, local_id, status,
              metadata, provider, payment_method, payment_gateway_response,
              order_id::text AS order_id, merchant_id::text AS merchant_id,
              store_id::text AS store_id, shift_id, user_id, currency, order_total
         FROM public.store_pos_payments
        WHERE order_id = $1::uuid
          AND entry_type = 'payment'
          AND deleted_at IS NULL`,
      [orderId],
    );
  }

  private async findGatewayPayment(ids: string[]): Promise<PaymentRow | null> {
    const rows = await this.query<PaymentRow>(
      `SELECT id::text AS id, amount, is_void, provider_transaction_id, local_id, status,
              metadata, provider, payment_method, payment_gateway_response,
              order_id::text AS order_id, merchant_id::text AS merchant_id,
              store_id::text AS store_id, shift_id, user_id, currency, order_total
         FROM public.store_pos_payments
        WHERE deleted_at IS NULL
          AND entry_type = 'payment'
          AND (
            provider_transaction_id = ANY($1::text[])
            OR metadata->>'payment_instruction_id' = ANY($1::text[])
            OR metadata->>'gateway_transaction_id' = ANY($1::text[])
            OR metadata->>'attempt_id' = ANY($1::text[])
          )
        ORDER BY created_at DESC
        LIMIT 1 /* payroc_webhook_payment */`,
      [ids],
    );
    return rows[0] ?? null;
  }

  private async findOrderById(orderId: string): Promise<SaleRow | null> {
    const rows = await this.query<SaleRow>(
      `${ORDER_LOOKUP_SELECT}
        WHERE sale.order_id = $1::uuid
        LIMIT 1`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  private async insertPayment(input: {
    order: SaleRow;
    shiftId: string;
    userId: string;
    paymentMethod: string;
    paymentMethodTitle: string;
    amount: number;
    payable: number;
    remaining: number;
    refundable: number;
    provider: string | null;
    transactionId: string;
    status: string;
    localId: string;
    metadata: Record<string, unknown>;
    requestedOrderId: string;
    gatewayResponse?: Record<string, unknown> | null;
  }): Promise<string> {
    const deviceId = input.order.device_id?.trim() ? input.order.device_id.trim() : null;
    const currency = String(input.order.currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    const params = [
      input.order.order_id,
      input.order.merchant_id,
      input.order.store_id,
      input.localId.slice(0, 150),
      input.order.client_order_id,
      deviceId,
      input.shiftId,
      input.userId,
      input.paymentMethod,
      input.paymentMethodTitle,
      input.amount,
      input.payable,
      input.remaining,
      input.refundable,
      currency,
      input.provider,
      input.transactionId || null,
      JSON.stringify(input.metadata),
      input.status,
      input.gatewayResponse ? JSON.stringify(input.gatewayResponse) : null,
    ];
    try {
      const rows = await this.query<{ id: string }>(
        `INSERT INTO public.store_pos_payments (
           order_id, merchant_id, store_id, local_id, client_order_id, device_id,
           shift_id, user_id, payment_type, payment_method, payment_method_title,
           amount, order_total, remaining, refundable_remaining, change_amount, refund_amount,
           currency, status, entry_type, is_void, provider, provider_transaction_id, payment_at, metadata,
           payment_gateway_response
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
           $7, $8, 'pos_payment'::public.store_pos_payment_type, $9, $10,
           $11, $12, $13, $14, 0, 0,
           $15, $19, 'payment', false, $16, $17, now(), $18::jsonb, $20::jsonb
         )
         RETURNING id::text AS id`,
        params,
      );
      const id = rows[0]?.id;
      if (!id) throw new ServiceUnavailableException('Payment record was not saved');
      console.log(`[Payment] saved ${id} for order ${input.order.order_id} via ${input.provider || input.paymentMethod}`);
      return id;
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.listPayments(input.order.order_id);
      const saved = existing.find((row) => row.local_id === input.localId.slice(0, 150));
      if (!saved) throw error;
      return saved.id;
    }
  }

  private async updatePayment(input: {
    id: string;
    status: string;
    provider: string | null;
    transactionId: string;
    metadata: Record<string, unknown>;
    remaining: number;
    refundable: number;
    paymentAt: string;
    gatewayResponse?: Record<string, unknown> | null;
  }): Promise<void> {
    const paymentAt = input.paymentAt && !Number.isNaN(Date.parse(input.paymentAt)) ? input.paymentAt : null;
    await this.query(
      `UPDATE public.store_pos_payments
          SET status = $2,
              provider = $3,
              provider_transaction_id = COALESCE(NULLIF($4, ''), provider_transaction_id),
              metadata = $5::jsonb,
              remaining = $6,
              refundable_remaining = $7,
              payment_at = COALESCE($8::timestamptz, payment_at),
              payment_gateway_response = COALESCE($9::jsonb, payment_gateway_response),
              updated_at = now()
        WHERE id = $1::uuid
          AND deleted_at IS NULL`,
      [
        input.id,
        input.status,
        input.provider,
        input.transactionId || '',
        JSON.stringify(input.metadata),
        input.remaining,
        input.refundable,
        paymentAt,
        input.gatewayResponse ? JSON.stringify(input.gatewayResponse) : null,
      ],
    );
  }

  /** Removes the order-sync card row when the charged card row for that amount already exists. */
  private async collapseDuplicateCardTenders(orderId: string, amount: number, method: string): Promise<void> {
    const family = tenderFamily(method);
    if (!family) return;
    await this.query(
      `UPDATE public.store_pos_payments AS extra
          SET deleted_at = now(),
              updated_at = now(),
              status = 'cancelled',
              metadata = COALESCE(extra.metadata, '{}'::jsonb)
                || jsonb_build_object('duplicate_card_tender', true)
        WHERE extra.order_id = $1::uuid
          AND extra.entry_type = 'payment'
          AND extra.deleted_at IS NULL
          AND extra.is_void = false
          AND extra.amount = $2::numeric
          AND (
            ($3 = 'card' AND lower(replace(replace(extra.payment_method, '_', '-'), ' ', '-')) IN ('card', 'pos-card', 'credit', 'debit', 'credit-card', 'debit-card'))
            OR ($3 = 'ebt' AND lower(replace(replace(extra.payment_method, '_', '-'), ' ', '-')) IN ('ebt', 'pos-ebt', 'ebt-card'))
          )
          AND extra.payment_gateway_response IS NULL
          AND NULLIF(btrim(extra.provider_transaction_id), '') IS NULL
          AND EXISTS (
            SELECT 1
              FROM public.store_pos_payments AS charged
             WHERE charged.order_id = extra.order_id
               AND charged.id <> extra.id
               AND charged.deleted_at IS NULL
               AND charged.entry_type = 'payment'
               AND charged.is_void = false
               AND charged.amount = extra.amount
               AND (
                 ($3 = 'card' AND lower(replace(replace(charged.payment_method, '_', '-'), ' ', '-')) IN ('card', 'pos-card', 'credit', 'debit', 'credit-card', 'debit-card'))
                 OR ($3 = 'ebt' AND lower(replace(replace(charged.payment_method, '_', '-'), ' ', '-')) IN ('ebt', 'pos-ebt', 'ebt-card'))
               )
               AND (
                 charged.payment_gateway_response IS NOT NULL
                 OR NULLIF(btrim(charged.provider_transaction_id), '') IS NOT NULL
               )
          ) /* collapse_duplicate_card_tender */`,
      [orderId, amount, family],
    );
  }

  /**
   * Mirrors the WordPress paid-versus-total status update.
   * Completed uses the existing order status transition. Partial only writes
   * status fields. Totals, tax, discounts, and line items stay as they are.
   * Cancelled orders keep the existing status lock.
   */
  private async applyOrderStatus(order: SaleRow, fullyPaid: boolean, userId: string): Promise<string> {
    if (String(order.order_status || '').toUpperCase() === 'CANCELLED') return 'cancelled';
    if (!fullyPaid) {
      await this.query(
        `UPDATE public.store_orders
            SET status = 'pending',
                payment_status = 'PENDING',
                set_paid = false,
                request_payload = CASE
                  WHEN jsonb_typeof(request_payload) = 'object'
                    THEN jsonb_set(request_payload, '{status}', to_jsonb('pending'::text), true)
                  ELSE request_payload
                END,
                status_history = CASE
                  WHEN jsonb_typeof(status_history) = 'array' THEN status_history
                  ELSE '[]'::jsonb
                END || $2::jsonb,
                updated_at = now()
          WHERE order_id = $1::uuid`,
        [order.order_id, JSON.stringify([{
          id: `HST-${randomUUID()}`,
          orderId: order.order_id,
          fromStatus: order.order_status || order.status || '',
          toStatus: order.order_status || order.status || '',
          changedBy: userId || 'POS System',
          reason: 'Partial payment received',
          createdAt: new Date().toISOString(),
        }])],
      );
      return 'pending';
    }
    try {
      const updated = await this.orders.updateOrderStatus(
        order.order_id,
        OrderStatus.COMPLETED,
        userId || 'POS System',
        'Payment completed via POS',
      );
      if (!updated) return this.currentStatus(order);
      await this.query(
        `UPDATE public.store_orders
            SET payment_status = 'PAID',
                set_paid = true,
                updated_at = now()
          WHERE order_id = $1::uuid`,
        [order.order_id],
      );
      return 'completed';
    } catch (error: unknown) {
      if (error instanceof ConflictException) return this.currentStatus(order);
      throw error;
    }
  }

  private currentStatus(order: SaleRow): string {
    const status = String(order.status || '').trim().toLowerCase();
    if (status) return status;
    return String(order.order_status || '').trim().toLowerCase().replace(/_/g, '-');
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const db = this.orders.database();
    if (!db) throw new ServiceUnavailableException('Order database is unavailable');
    try {
      const result: unknown = await db.query(sql, params);
      if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
      return Array.isArray(result) ? result as T[] : [];
    } catch (error: unknown) {
      const driver = error instanceof QueryFailedError
        ? (error as { driverError?: { code?: string; message?: string } }).driverError
        : undefined;
      if (driver?.code === '22P02') throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      const detail = driver?.message || (error instanceof Error ? error.message : 'Payment query failed');
      console.error(`[Payment] database query failed: ${detail}`);
      throw error;
    }
  }
}

const ORDER_LOOKUP_SELECT = `
  SELECT sale.order_id::text AS order_id,
         sale.merchant_id::text AS merchant_id,
         sale.store_id::text AS store_id,
         sale.client_order_id,
         sale.device_id,
         sale.currency,
         sale.total,
         sale.status,
         sale.order_status,
         sale.request_payload
    FROM public.store_orders AS sale`;

function attemptLocalId(body: Record<string, unknown>, headerKey?: string): string {
  const candidates = [
    body.local_id,
    body.localId,
    body.idempotency_key,
    body.idempotencyKey,
    body.payment_local_id,
    body.paymentLocalId,
    headerKey,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value.slice(0, 150);
  }
  return `gateway:${randomUUID()}`;
}

function paidTotal(rows: PaymentRow[]): number {
  return money(rows.reduce((sum, row) => sum + (countsAsCaptured(row) ? numberValue(row.amount) : 0), 0));
}

const CARD_METHODS = new Set(['card', 'pos-card', 'credit', 'debit', 'credit-card', 'debit-card']);
const EBT_METHODS = new Set(['ebt', 'pos-ebt', 'ebt-card']);

function normalizeTender(method: unknown): string {
  return String(method || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function tenderFamily(method: unknown): 'card' | 'ebt' | null {
  const normalized = normalizeTender(method);
  if (CARD_METHODS.has(normalized)) return 'card';
  if (EBT_METHODS.has(normalized)) return 'ebt';
  return null;
}

function isCardMethod(method: unknown): boolean {
  return tenderFamily(method) === 'card';
}

function isEbtMethod(method: unknown): boolean {
  return tenderFamily(method) === 'ebt';
}

function sameMoney(left: unknown, right: number): boolean {
  return Math.abs(numberValue(left) - right) < 0.001;
}

function hasGatewayResult(row: PaymentRow): boolean {
  return Boolean(textOf(row.provider_transaction_id) || row.payment_gateway_response);
}

/**
 * The order snapshot and the payment API both record one card tender.
 * A POS-CARD shell has no gateway payload. Reuse it, or the already charged
 * row sitting next to that shell. A finished attempt with its own local id
 * is left alone so a later attempt can insert its own row.
 */
function adoptableCardPayment(rows: PaymentRow[], amount: number, method: string): PaymentRow | undefined {
  const family = tenderFamily(method);
  const cards = rows.filter((row) => tenderFamily(row.payment_method) === family && family !== null && !row.is_void && sameMoney(row.amount, amount));
  const charged = cards.filter((row) => hasGatewayResult(row));
  const shells = cards.filter((row) => !hasGatewayResult(row));
  if (charged.length === 1 && shells.length >= 1) return charged[0];
  if (charged.length === 0 && shells.length === 1) return shells[0];
  return undefined;
}

function gatewayResponseDocument(details: Record<string, unknown> | null): Record<string, unknown> | null {
  const record = asRecord(details);
  if (!record) return null;
  const payment = record.gateway_response ?? record;
  const instruction = record.instruction;
  if (instruction && record.gateway_response !== undefined) {
    return { instruction, payment: record.gateway_response };
  }
  const body = asRecord(payment);
  return body ?? record;
}

function countsAsCaptured(row: PaymentRow): boolean {
  if (row.is_void) return false;
  const status = String(row.status || 'completed').trim().toLowerCase();
  return !['failed', 'cancelled', 'canceled', 'declined', 'pending'].includes(status);
}

function gatewayAlreadySubmitted(row: PaymentRow): boolean {
  const metadata = metadataRecord(row.metadata);
  return metadata.gateway_submitted === true || Boolean(textOf(row.provider_transaction_id));
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function gatewayFacts(details: Record<string, unknown> | null | undefined): {
  code: string;
  message: string;
  status: string;
  at: string;
  instructionId: string;
} {
  const source = asRecord(details?.gateway_response) ?? details ?? {};
  const result = asRecord(source.transactionResult) ?? asRecord(details?.transactionResult);
  const order = asRecord(source.order) ?? asRecord(details?.order);
  return {
    code: textOf(result?.responseCode) || textOf(source.response) || textOf(details?.response),
    message: textOf(result?.responseMessage) || textOf(source.responsetext) || textOf(details?.responsetext),
    status: textOf(result?.status) || textOf(source.status) || textOf(details?.status),
    at: textOf(order?.dateTime) || textOf(source.dateTime),
    instructionId: textOf(details?.paymentInstructionId) || textOf(source.paymentInstructionId),
  };
}

function gatewayReferenceIds(body: Record<string, unknown>): string[] {
  const values = [
    body.paymentInstructionId,
    body.payment_instruction_id,
    body.paymentId,
    body.payment_id,
    body.transactionId,
    body.transaction_id,
    body.provider_transaction_id,
    asRecord(body.data)?.paymentInstructionId,
    asRecord(body.data)?.paymentId,
  ];
  return [...new Set(values.map((value) => textOf(value)).filter(Boolean))];
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function isUniqueViolation(error: unknown): boolean {
  const driver = error instanceof QueryFailedError
    ? (error as { driverError?: { code?: string } }).driverError
    : undefined;
  return driver?.code === '23505';
}

function declineBody(outcome: Extract<GatewayOutcome, { kind: 'declined' }>): CreatePaymentDecline {
  return {
    success: false,
    status: 'declined',
    message: outcome.message,
    ...(outcome.response !== undefined ? { response: outcome.response } : {}),
  };
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
