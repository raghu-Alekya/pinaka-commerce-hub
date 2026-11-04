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
import {
  isPhpEmpty,
  readPaymentAmount,
  resolvePaymentGateway,
  transactionFields,
  type GatewayOutcome,
} from './payment-gateway';

export interface CreatePaymentContext {
  merchantId: string;
  storeId: string;
  userId: string;
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
}

interface PaymentRow {
  id: string;
  amount: string | number;
  is_void: boolean;
  provider_transaction_id: string | null;
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
  ): Promise<CreatePaymentSuccess | CreatePaymentDecline> {
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

    const gatewayResult = paymentMethodRaw.toLowerCase() === 'card'
      ? await this.chargeCard(order, amount, context)
      : { provider: null as string | null, transactionId: '', details: null as Record<string, unknown> | null };
    if ('decline' in gatewayResult) return gatewayResult.decline;

    const payable = await this.payableTotal(order);
    const existing = await this.listPayments(order.order_id);
    const transactionId = gatewayResult.transactionId;
    const replay = transactionId
      ? existing.find((row) => row.provider_transaction_id === transactionId)
      : undefined;
    const captured = replay
      ? existing
      : [...existing, { id: '', amount, is_void: false, provider_transaction_id: transactionId || null }];
    const totalPaid = money(captured.reduce((sum, row) => sum + (row.is_void ? 0 : numberValue(row.amount)), 0));
    const remaining = Math.max(0, money(payable - totalPaid));
    const paymentId = replay
      ? replay.id
      : await this.insertPayment({
        order,
        shiftId,
        userId: context.userId.slice(0, 150),
        paymentMethod,
        paymentMethodTitle: paymentMethodRaw.trim().slice(0, 150) || paymentMethod,
        amount,
        payable,
        remaining,
        provider: gatewayResult.provider,
        transactionId,
        details: gatewayResult.details,
        requestedOrderId: String(body.order_id).trim(),
      });

    const fullyPaid = Math.round(totalPaid * 100) >= Math.round(payable * 100);
    const orderStatus = await this.applyOrderStatus(order, fullyPaid, context.userId);
    return {
      success: true,
      status: 'success',
      message: 'Payment successful',
      payment_id: paymentId,
      transaction_id: transactionId || null,
      transaction_details: gatewayResult.details ?? [],
      order_id: order.order_id,
      paid_amount: amount,
      total_paid: totalPaid,
      remaining_amount: remaining,
      order_total: payable,
      order_status: orderStatus,
    };
  }

  private async chargeCard(
    order: SaleRow,
    amount: number,
    context: CreatePaymentContext,
  ): Promise<{ provider: string | null; transactionId: string; details: Record<string, unknown> | null } | { decline: CreatePaymentDecline }> {
    const configuration = await this.gatewayConfiguration(context.storeId);
    const resolved = resolvePaymentGateway(configuration);
    if (!resolved.ok) throw new BadRequestException(resolved.message);
    if (resolved.gateway === 'offline') {
      return { provider: null, transactionId: '', details: null };
    }
    const outcome = resolved.gateway === 'kickback'
      ? await this.gateways.chargeKickback({
        deviceId: resolved.credentials.deviceId,
        secretKey: resolved.credentials.secretKey,
        amount,
      })
      : await this.gateways.chargePayroc({
        deviceId: resolved.credentials.deviceId,
        terminalId: resolved.credentials.terminalId,
        secretKey: resolved.credentials.secretKey,
        amount,
        orderId: order.order_id,
        operator: context.userId,
      });
    if (outcome.kind === 'failed') throw new HttpException(outcome.message, outcome.statusCode);
    if (outcome.kind === 'declined') {
      console.error(`[Payment] ${resolved.gateway} declined for order ${order.order_id}: ${outcome.message}`);
      return { decline: declineBody(outcome) };
    }
    return { provider: resolved.gateway, transactionId: outcome.transactionId, details: outcome.details };
  }

  private async findOrder(context: CreatePaymentContext, orderKey: string): Promise<SaleRow | null> {
    const params = [context.merchantId, context.storeId, orderKey];
    const internal = await this.query<SaleRow>(
      `${ORDER_LOOKUP_SELECT}
        WHERE sale.merchant_id = $1::uuid
          AND sale.store_id = $2::uuid
          AND (
            sale.order_id::text = $3
            OR sale.id::text = $3
            OR sale.client_order_id = $3
            OR sale.order_number = $3
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
        WHERE sale.merchant_id = $1::uuid
          AND sale.store_id = $2::uuid
          AND (
            EXISTS (
              SELECT 1
                FROM public.store_orders_meta AS meta
               WHERE meta.order_id = sale.order_id
                 AND meta.meta_key = '_pos_client_order_id'
                 AND btrim(both '"' from btrim(COALESCE(meta.meta_value #>> '{}', ''))) = $3
            )
            OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(sale.meta_data) = 'array' THEN sale.meta_data ELSE '[]'::jsonb END
                  || CASE WHEN jsonb_typeof(sale.metadata) = 'array' THEN sale.metadata ELSE '[]'::jsonb END
                  || CASE WHEN jsonb_typeof(sale.request_payload->'meta_data') = 'array'
                       THEN sale.request_payload->'meta_data' ELSE '[]'::jsonb END
                ) AS entry
               WHERE entry->>'key' = '_pos_client_order_id'
                 AND btrim(both '"' from btrim(COALESCE(entry->>'value', ''))) = $3
            )
          )
        ORDER BY sale.created_at DESC
        LIMIT 1`,
      params,
    );
    return byClientOrder[0] ?? null;
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
                 WHEN jsonb_typeof(sale.metadata) = 'array' THEN sale.metadata
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
      `SELECT id::text AS id, amount, is_void, provider_transaction_id
         FROM public.store_pos_payments
        WHERE order_id = $1::uuid
          AND entry_type = 'payment'
          AND deleted_at IS NULL`,
      [orderId],
    );
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
    provider: string | null;
    transactionId: string;
    details: Record<string, unknown> | null;
    requestedOrderId: string;
  }): Promise<string> {
    const deviceId = input.order.device_id?.trim() ? input.order.device_id.trim() : null;
    const details = input.details ?? {};
    const metadata = {
      source: 'api/v1/payments/create-payment',
      payment_status: 'success',
      void: false,
      transaction_details: details,
      transaction_fields: transactionFields(details),
      ...(deviceId ? {} : { device_id_missing_source: true }),
      source_payload: {
        order_id: input.requestedOrderId,
        amount: input.amount,
        payment_method: input.paymentMethod,
        shift_id: input.shiftId,
        remaining: input.remaining,
      },
    };
    const currency = String(input.order.currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    const rows = await this.query<{ id: string }>(
      `INSERT INTO public.store_pos_payments (
         order_id, merchant_id, store_id, local_id, client_order_id, device_id,
         shift_id, user_id, payment_type, payment_method, payment_method_title,
         amount, order_total, remaining, refundable_remaining, change_amount, refund_amount,
         currency, status, entry_type, is_void, provider, provider_transaction_id, payment_at, metadata
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
         $7, $8, 'pos_payment'::public.store_pos_payment_type, $9, $10,
         $11, $12, $13, $14, 0, 0,
         $15, 'completed', 'payment', false, $16, $17, now(), $18::jsonb
       )
       RETURNING id::text AS id`,
      [
        input.order.order_id,
        input.order.merchant_id,
        input.order.store_id,
        `gateway:${randomUUID()}`,
        input.order.client_order_id,
        deviceId,
        input.shiftId,
        input.userId,
        input.paymentMethod,
        input.paymentMethodTitle,
        input.amount,
        input.payable,
        input.remaining,
        input.amount,
        currency,
        input.provider,
        input.transactionId || null,
        JSON.stringify(metadata),
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new ServiceUnavailableException('Payment record was not saved');
    console.log(`[Payment] saved ${id} for order ${input.order.order_id} via ${input.provider || input.paymentMethod}`);
    return id;
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
      const code = error instanceof QueryFailedError
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (code === '22P02') throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
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
         sale.order_status
    FROM public.store_orders AS sale`;

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
