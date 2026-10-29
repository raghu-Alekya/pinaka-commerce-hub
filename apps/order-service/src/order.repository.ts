import { BadRequestException, ConflictException, Injectable, OnModuleInit, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import { OrderEntity, OrderType, PaymentMethod, PaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { StoreOrderEntity } from './entities/store-order.entity';
import { StoreOrderMetaEntity } from './entities/store-order-meta.entity';
import { cashChangeReturned, isCashTender } from './calculations/order-change';
import { ensureStorePosPaymentsSchema } from './schemas/store-pos-payments.schema';
import { ensureStoreOrdersMetaSchema } from './schemas/store-orders-meta.schema';
import {
  allocateRoundedTax,
  authoritativeCouponDiscount,
  applyCouponDiscountToStoredLinesAndTax,
  applyMerchantDiscountToStoredTax,
  adminOrderCounts,
  calculateDiscountTotal,
  calculateStoreOrder,
  effectiveFeeTotal,
  feeLinesForCalculation,
  isTaxableSaleLine,
  listOrderTotal,
  orderTotalWithTax,
  representedCouponDiscount,
  sumCouponDiscounts,
  type StoreOrderCalculationInput,
  sumLineSubtotals,
  sumLineTotals,
  taxUnitsForMinor,
} from './calculations/store-order.calculations';

@Injectable()
export class OrderRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private storeOrderRepo?: Repository<StoreOrderEntity>;
  private itemRepo?: Repository<OrderItemEntity>;
  private historyRepo?: Repository<OrderStatusHistoryEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryOrders: OrderEntity[] = [];
  private inMemoryItems: OrderItemEntity[] = [];
  private inMemoryHistory: OrderStatusHistoryEntity[] = [];

  async onModuleInit() {
    try {
      await this.migrateLegacyOrderIdsBeforeOrm();
      await this.migrateOrderColumnsToSnakeCase();
      this.dataSource = new DataSource({
        ...postgresConnectionOptions([StoreOrderEntity, StoreOrderMetaEntity, OrderItemEntity, OrderStatusHistoryEntity]),
        synchronize: false,
      });
      await this.dataSource.initialize();
      await this.ensureOrderUuidSchema();
      await this.ensurePosOrderColumns();
      await this.ensureStoreOrdersTable();
      await ensureStorePosPaymentsSchema(this.dataSource);
      await ensureStoreOrdersMetaSchema(this.dataSource);
      this.storeOrderRepo = this.dataSource.getRepository(StoreOrderEntity);
      this.itemRepo = this.dataSource.getRepository(OrderItemEntity);
      this.historyRepo = this.dataSource.getRepository(OrderStatusHistoryEntity);
      this.isDbConnected = true;
    } catch (err: any) {
      console.log(`⚠️ [Order Service DB] Offline (${err.message}). Using in-memory store fallback.`);
      this.isDbConnected = false;
    }

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 3000,
        maxRetriesPerRequest: 1,
        // Do not hold Nest's startup open retrying an unavailable optional cache.
        retryStrategy: () => null,
      });
      const redisConnectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 3000;
      let redisConnectTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.redisClient.connect(),
          new Promise<never>((_, reject) => {
            redisConnectTimer = setTimeout(
              () => reject(new Error(`Redis connection timed out after ${redisConnectTimeoutMs}ms`)),
              redisConnectTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (redisConnectTimer) clearTimeout(redisConnectTimer);
      }
      this.isRedisConnected = true;
      console.log('⚡ [Order Service Redis] Connected to Redis Container');
    } catch (err: any) {
      this.redisClient?.disconnect();
      console.log(`⚠️ [Order Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  async calculate(input: StoreOrderCalculationInput = {}, storeId?: string) {
    const result = calculateStoreOrder(input);
    if (!input.includeCashbackFee) return { ...result, cashbackFee: 0 };
    const cashbackLine = (input.lineItems || []).find(
      (line) => String(line?.name || '').trim().toLowerCase() === 'cashback',
    );
    const amount = input.cashbackAmount ?? Math.abs(Number(cashbackLine?.total || 0));
    const cashbackFee = await this.cashbackFeeForAmount(storeId || '', amount);
    return { ...result, cashbackFee };
  }

  database() {
    return this.isDbConnected ? this.dataSource : undefined;
  }

  async createOrder(orderData: any): Promise<{ order: OrderEntity; items: OrderItemEntity[]; storeOrder: StoreOrderEntity | null; duplicate: boolean }> {
    if (!this.isDbConnected || !this.dataSource || !this.storeOrderRepo) {
      throw new ServiceUnavailableException('Order database is unavailable; the order was not saved');
    }
    const sourcePayload = JSON.parse(JSON.stringify(orderData.requestPayload || {}));
    if (this.isDbConnected && this.dataSource) {
      const stores = await this.dataSource.query(
        `SELECT id, merchant_id, currency, timezone
         FROM public.stores
         WHERE id = $1::uuid AND COALESCE(is_deleted, false) = false
         LIMIT 1`,
        [orderData.storeId],
      );
      if (!stores.length) {
        throw new BadRequestException(`Store '${orderData.storeId}' was not found`);
      }
      orderData.merchantId = orderData.merchantId || stores[0].merchant_id;
      orderData.currency = stores[0].currency || 'USD';
      orderData.timezone = stores[0].timezone || 'UTC';
    }
    const clientOrderId = String(orderData.clientOrderId || '').trim() || undefined;
    // A POS cancellation is sent through the create endpoint with the original
    // client order id. Resolve and cancel it before product/tax enrichment: the
    // navigation snapshot may contain stale coupon/item data, but cancellation
    // must only depend on the persisted order identity and requested status.
    const incomingStatus = String(orderData.orderStatus || orderData.status || sourcePayload?.status || '')
      .trim().replace(/-/g, '_').toUpperCase();
    if (clientOrderId && incomingStatus === OrderStatus.CANCELLED) {
      const duplicate = await this.findDuplicateClientOrder(orderData.storeId, clientOrderId);
      if (duplicate) {
        const cancelled = await this.cancelDuplicateIfRequested(duplicate.orderId, orderData, sourcePayload);
        if (!cancelled) throw new ServiceUnavailableException('The existing order could not be cancelled');
        return {
          order: cancelled.order,
          items: cancelled.items,
          storeOrder: cancelled.storeOrder,
          duplicate: true,
        };
      }
    }
    await this.enrichWooCommerceCreateOrder(orderData, sourcePayload);
    if (clientOrderId) {
      const duplicate = await this.findDuplicateClientOrder(orderData.storeId, clientOrderId);
      if (duplicate) {
        const cancelled = await this.cancelDuplicateIfRequested(duplicate.orderId, orderData, sourcePayload);
        if (!cancelled) {
          throw new ConflictException(`An order with client order ID '${clientOrderId}' already exists`);
        }
        return {
          order: cancelled.order,
          items: cancelled.items,
          storeOrder: cancelled.storeOrder,
          duplicate: true,
        };
      }
    }
    const id = randomUUID();
    const orderNumber = `#${Math.floor(1000 + Math.random() * 9000)}`;

    let subtotal = 0;
    const items: OrderItemEntity[] = (orderData.items || []).map((i: any, idx: number) => {
      const lineTotal = i.totalPrice !== undefined
        ? Number(i.totalPrice)
        : Number(i.quantity || 1) * Number(i.unitPrice || 0);
      subtotal += lineTotal;
      return {
        id: `ITEM-${id}-${idx + 1}`,
        orderId: id,
        productId: i.productId || `PROD-${idx + 1}`,
        productName: i.productName || 'Sales Item',
        quantity: Number(i.quantity || 1),
        unitPrice: Number(i.unitPrice || 0),
        totalPrice: lineTotal,
        modifiers: i.modifiers || [],
      };
    });

    subtotal = orderData.subtotal !== undefined ? Number(orderData.subtotal) : subtotal;
    const taxAmount = orderData.taxAmount !== undefined ? Number(orderData.taxAmount) : Math.round(subtotal * 0.0825 * 100) / 100;
    const discountAmount = Number(orderData.discountAmount || 0);
    const tipAmount = Number(orderData.tipAmount || 0);
    const totalAmount = orderData.totalAmount !== undefined
      ? Number(orderData.totalAmount)
      : subtotal - discountAmount + tipAmount;

    const order: OrderEntity = {
      id,
      orderNumber,
      merchantId: orderData.merchantId || 'MCH-1001',
      storeId: orderData.storeId || 'STR-5001',
      shiftId: orderData.shiftId || 'SHIFT-8001',
      localShiftId: orderData.localShiftId,
      clientOrderId,
      offline: Boolean(orderData.offline),
      metadata: Array.isArray(orderData.metadata) ? orderData.metadata : [],
      requestPayload: orderData.requestPayload,
      customerName: orderData.customerName || 'Walk-in Customer',
      customerPhone: orderData.customerPhone || '',
      orderType: orderData.orderType || OrderType.IN_STORE_POS,
      paymentMethod: orderData.paymentMethod || PaymentMethod.CASH,
      paymentStatus: orderData.paymentStatus || PaymentStatus.PAID,
      subtotal,
      taxAmount,
      discountAmount,
      tipAmount,
      totalAmount,
      orderStatus: orderData.orderStatus || OrderStatus.CREATED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const storeOrder = this.buildStoreOrder(id, orderData, sourcePayload);
    storeOrder.orderNumber = order.orderNumber;
    storeOrder.customerName = order.customerName;
    storeOrder.customerPhone = order.customerPhone;
    storeOrder.orderType = order.orderType;
    storeOrder.paymentMethodCode = order.paymentMethod;
    storeOrder.paymentStatus = order.paymentStatus;
    storeOrder.tipAmount = order.tipAmount;
    storeOrder.offline = order.offline;
    storeOrder.localShiftId = order.localShiftId;
    storeOrder.metadata = order.metadata;
    storeOrder.requestPayload = order.requestPayload;
    storeOrder.orderStatus = order.orderStatus;
    storeOrder.statusHistory = [{
      id: `HST-${Date.now()}`,
      orderId: id,
      fromStatus: 'NONE',
      toStatus: order.orderStatus,
      changedBy: 'POS System',
      reason: 'Initial Order Creation',
      createdAt: new Date(),
    }];
    if (this.isDbConnected && this.storeOrderRepo && this.dataSource) {
      let savedStoreOrder: StoreOrderEntity;
      try {
        const saved = await this.dataSource.transaction(async manager => {
          const storeOrderRepository = manager.getRepository(StoreOrderEntity);
          const paymentRows = this.buildStorePosPaymentRows(id, order, orderData, sourcePayload, storeOrder);
          const persistedStoreOrder = await storeOrderRepository.save(storeOrderRepository.create(storeOrder));
          await this.saveLineItems(manager, id, items, true);
          await this.saveStatusHistory(manager, storeOrder.statusHistory[0] as OrderStatusHistoryEntity);
          if (paymentRows.length) {
            await manager.query(
              `INSERT INTO public.store_pos_payments (
                 order_id, merchant_id, store_id, local_id, client_order_id, device_id,
                 shift_id, user_id, payment_type, payment_method, payment_method_title,
                 amount, order_total, remaining, refund_amount,
                 currency, status, entry_type, provider,
                 provider_transaction_id, payment_at, metadata
               ) VALUES ${paymentRows.map((_, index) => {
                 const offset = index * 22;
                 return `(${Array.from({ length: 22 }, (_value, column) => `$${offset + column + 1}`).join(', ')})`;
               }).join(', ')}
               ON CONFLICT DO NOTHING`,
              paymentRows.flat(),
            );
          }
          await this.saveStoreOrderMeta(manager, id, storeOrder.metadata, storeOrder.metaData);
          return { persistedStoreOrder };
        });
        savedStoreOrder = saved.persistedStoreOrder;
      } catch (error: unknown) {
        if (error instanceof QueryFailedError && (error as any).driverError?.code === '22P02') {
          throw new BadRequestException(
            'Invalid UUID identifier. Send shift_id as the UUID value returned by pos_shifts.',
          );
        }
        if (error instanceof QueryFailedError && (error as any).driverError?.code === '23505' && clientOrderId) {
          throw new ConflictException(`An order with client order ID '${clientOrderId}' already exists`);
        }
        throw error;
      }
      const savedOrder = this.projectOrder(savedStoreOrder);
      await this.cacheOrder(savedOrder);
      console.log(`🛍️ [Order Created] Order ${savedOrder.orderNumber} ($${savedOrder.totalAmount}) created for Store ${savedOrder.storeId}`);
      return { order: savedOrder, items, storeOrder: savedStoreOrder, duplicate: false };
    } else {
      this.inMemoryOrders.unshift(order);
      this.inMemoryItems.push(...items);
      this.inMemoryHistory.push({
        id: `HST-${Date.now()}`,
        orderId: id,
        fromStatus: 'NONE',
        toStatus: order.orderStatus,
        changedBy: 'POS System',
        reason: 'Initial Order Creation',
        createdAt: new Date(),
      });
      await this.cacheOrder(order);
      console.log(`🛍️ [Order Created (InMemory)] Order ${order.orderNumber} ($${order.totalAmount}) created for Store ${order.storeId}`);
      return { order, items, storeOrder, duplicate: false };
    }
  }

  private async findDuplicateClientOrder(
    storeId: string,
    clientOrderId: string,
  ): Promise<{ orderId: string } | undefined> {
    const existing = this.isDbConnected && this.storeOrderRepo
      ? await this.storeOrderRepo.findOne({ where: { storeId, clientOrderId } })
      : this.inMemoryOrders.find(order => order.storeId === storeId && order.clientOrderId === clientOrderId);
    if (!existing) return undefined;
    return { orderId: 'orderId' in existing ? existing.orderId : existing.id };
  }

  private async cancelDuplicateIfRequested(orderId: string, orderData: any, sourcePayload: any) {
    const incomingStatus = String(orderData.orderStatus || orderData.status || sourcePayload?.status || '')
      .trim().replace(/-/g, '_').toUpperCase();
    if (incomingStatus !== OrderStatus.CANCELLED) return null;
    const updated = await this.updateOrderStatus(
      orderId,
      OrderStatus.CANCELLED,
      String(orderData.placedBy || 'POS System'),
      'Duplicate POS sync requested cancellation',
    );
    const graph = updated ? await this.getOrderById(updated.id) : null;
    if (!graph) throw new ServiceUnavailableException('The existing order could not be cancelled');
    return graph;
  }

  private buildStoreOrder(orderId: string, orderData: any, sourcePayload: any): StoreOrderEntity {
    const metadata = Array.isArray(sourcePayload?.meta_data)
      ? sourcePayload.meta_data
      : (Array.isArray(orderData.metadata) ? orderData.metadata : []);
    const posPayments = metadata.find((entry: any) => entry?.key === '_pos_payments')?.value;
    const metaText = (...keys: string[]) => {
      const value = metadata.find((entry: any) => keys.includes(String(entry?.key || '')))?.value;
      if (value === undefined || value === null || value === '') return undefined;
      return String(value);
    };
    const lineItems = Array.isArray(sourcePayload?.line_items)
      ? sourcePayload.line_items
      : (orderData.items || []).map((item: any) => ({
          product_id: item.productId,
          name: item.productName,
          quantity: item.quantity,
          subtotal: item.totalPrice,
          total: item.totalPrice,
          meta_data: item.modifiers || [],
        }));
    const feeLines = Array.isArray(sourcePayload?.fee_lines) ? sourcePayload.fee_lines : [];
    const couponLines = Array.isArray(sourcePayload?.coupon_lines) ? sourcePayload.coupon_lines : [];
    const taxTotal = Number(sourcePayload?.total_tax ?? orderData.taxAmount ?? 0);
    const total = Number(sourcePayload?.total ?? orderData.totalAmount ?? sumLineTotals(lineItems));
    const shippingTotal = Number(sourcePayload?.shipping_total ?? sourcePayload?.shippingTotal ?? 0);
    const tipAmount = Number(orderData.tipAmount || 0);
    const calculationFees = feeLinesForCalculation(lineItems, feeLines);
    const discountTotal = calculateDiscountTotal(lineItems, couponLines, feeLines);
    const payLaterUserId = metaText('_pay_later_user_id');
    return {
      id: randomUUID(),
      orderId,
      merchantId: orderData.merchantId,
      storeId: orderData.storeId,
      orderNumber: '',
      customerName: orderData.customerName || 'Walk-in Customer',
      customerPhone: orderData.customerPhone || undefined,
      orderType: orderData.orderType || 'IN_STORE_POS',
      paymentMethodCode: orderData.paymentMethod,
      paymentStatus: orderData.paymentStatus || 'PAID',
      tipAmount,
      offline: Boolean(orderData.offline),
      localShiftId: orderData.localShiftId,
      metadata: Array.isArray(orderData.metadata) ? orderData.metadata : metadata,
      requestPayload: orderData.requestPayload,
      orderStatus: orderData.orderStatus || 'CREATED',
      statusHistory: [],
      clientOrderId: metaText('_pos_client_order_id') || orderData.clientOrderId || undefined,
      deviceId: orderData.deviceId || metaText('pos_device_id', '_pos_device_id', 'device_id'),
      placedBy: metaText('pos_placed_by'),
      shiftId: metaText('shift_id') || orderData.shiftId || undefined,
      currency: String(orderData.currency || 'USD').toUpperCase(),
      timezone: String(orderData.timezone || 'UTC'),
      paymentMethod: sourcePayload?.payment_method || undefined,
      paymentMethodTitle: sourcePayload?.payment_method_title || undefined,
      setPaid: Boolean(sourcePayload?.set_paid),
      status: String(sourcePayload?.status || orderData.orderStatus || 'processing').toLowerCase(),
      payLater: Boolean(metadata.find((entry: any) => entry?.key === '_pay_later')?.value),
      payLaterUserId,
      subtotal: sumLineSubtotals(lineItems),
      discountTotal,
      feeTotal: effectiveFeeTotal(calculationFees),
      taxTotal,
      total,
      grandTotal: listOrderTotal({
        total,
        tax: taxTotal,
        taxLines: Array.isArray(sourcePayload?.tax_lines) ? sourcePayload.tax_lines : [],
        couponDiscount: sumCouponDiscounts(couponLines),
        lineItems,
        feeLines: calculationFees,
        shippingTotal,
        tip: tipAmount,
      }),
      lineItems,
      feeLines,
      couponLines,
      taxLines: Array.isArray(sourcePayload?.tax_lines) ? sourcePayload.tax_lines : [],
      payments: Array.isArray(sourcePayload?.payments)
        ? sourcePayload.payments
        : Array.isArray(orderData.payments) ? orderData.payments
          : Array.isArray(posPayments) ? posPayments : [],
      metaData: metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private buildStorePosPaymentRows(
    orderId: string,
    order: OrderEntity,
    orderData: any,
    sourcePayload: any,
    storeOrder: StoreOrderEntity,
  ): any[][] {
    const submittedPayments = Array.isArray(sourcePayload?.payments)
      ? sourcePayload.payments
      : Array.isArray(orderData?.payments) ? orderData.payments
        : (() => {
            const metadata = Array.isArray(sourcePayload?.meta_data)
              ? sourcePayload.meta_data
              : Array.isArray(orderData?.metadata) ? orderData.metadata : [];
            const value = metadata.find((entry: any) => entry?.key === '_pos_payments')?.value;
            return Array.isArray(value) ? value : [];
          })();
    const payments = submittedPayments.length
      ? submittedPayments
      : [{
          method: sourcePayload?.payment_method || orderData?.paymentMethod || order.paymentMethod,
          method_title: sourcePayload?.payment_method_title || orderData?.paymentMethodTitle,
          amount: sourcePayload?.amount_paid ?? sourcePayload?.total ?? orderData?.totalAmount ?? order.totalAmount,
          status: sourcePayload?.set_paid === false ? 'pending' : 'completed',
          transaction_id: sourcePayload?.transaction_id ?? sourcePayload?.transactionId,
          provider: sourcePayload?.provider,
        }];

    const rawOrderTotal = Number(order.totalAmount || 0);
    const metadataEntries = Array.isArray(sourcePayload?.meta_data)
      ? sourcePayload.meta_data
      : Array.isArray(orderData?.metadata) ? orderData.metadata : [];
    const cashPaid = metadataEntries.find((entry: any) => entry?.key === 'pos_cash_paid' || entry?.key === '_pos_cash_paid')?.value;
    const change = cashChangeReturned({
      orderTotal: rawOrderTotal,
      cashPaid,
      payments: payments.map((payment: any) => ({
        method: payment?.payment_method ?? payment?.paymentMethod ?? payment?.method ?? sourcePayload?.payment_method ?? order.paymentMethod,
        amount: payment?.amount ?? payment?.total ?? payment?.value,
        status: payment?.status ?? (orderData?.paymentStatus === PaymentStatus.PENDING ? 'pending' : 'completed'),
      })),
    });
    this.upsertOrderMeta(storeOrder, [
      { key: 'pos_change_returned', value: change.change.toFixed(2) },
      { key: 'pos_cash_received', value: change.cashReceived.toFixed(2) },
    ]);
    order.metadata = storeOrder.metadata;
    let lastCashIndex = -1;
    payments.forEach((payment: any, index: number) => {
      const tender = payment?.payment_method ?? payment?.paymentMethod ?? payment?.method
        ?? sourcePayload?.payment_method ?? order.paymentMethod;
      if (isCashTender(tender)) lastCashIndex = index;
    });
    // Payout lines represent cash leaving the register, not a customer payment.
    // The order may therefore have a negative total, while the payment ledger
    // only stores non-negative captured/refundable amounts.
    const orderTotal = Number.isFinite(rawOrderTotal) ? Math.max(0, rawOrderTotal) : 0;
    const normalizedAmounts = payments.map((payment: any) => Number(
      payment?.amount ?? payment?.total ?? payment?.value ?? 0,
    ));
    return payments.map((payment: any, index: number) => {
      const amount = normalizedAmounts[index];
      // A payout may be represented as a negative tender alongside a positive
      // EBT tender. It is cash leaving the drawer, not a captured customer
      // payment, so it must not create a negative payment-ledger balance.
      const capturedAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
      const method = String(payment?.payment_method ?? payment?.paymentMethod ?? payment?.method ??
        sourcePayload?.payment_method ?? order.paymentMethod ?? 'cash').trim().toLowerCase();
      const paymentAtValue = payment?.payment_at ?? payment?.paymentAt ?? payment?.created_at ?? payment?.createdAt;
      const paymentAtText = String(paymentAtValue || '').trim();
      const parsedPaymentAt = paymentAtText && !Number.isNaN(Date.parse(paymentAtText))
        ? new Date(paymentAtText)
        : order.createdAt;
      // A timestamp without Z/offset is a client wall-clock value. Containers
      // parse it as UTC, which previously put payments hours into the future.
      // Preserve explicitly zoned and historical timestamps; for an unzoned
      // future value, the server capture time is the reliable instant.
      const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(paymentAtText);
      const paymentAt = !hasExplicitOffset && parsedPaymentAt.getTime() > order.createdAt.getTime() + 5 * 60_000
        ? order.createdAt
        : parsedPaymentAt;
      const suppliedLocalId = payment?.local_id ?? payment?.localId ?? payment?.payment_id
        ?? payment?.paymentId ?? payment?.id;
      const localId = suppliedLocalId ?? `generated:${index + 1}`;
      const deviceId = payment?.device_id ?? payment?.deviceId ?? orderData?.device_id ?? orderData?.deviceId
        ?? storeOrder.deviceId ?? null;
      // `remaining` is the refundable balance of this payment row, not the
      // outstanding total of the whole order.
      const remaining = capturedAmount;
      const rawPayload = payment && typeof payment === 'object' ? payment : { value: payment };
      const metadata = {
        ...(payment?.metadata && typeof payment.metadata === 'object' ? payment.metadata : {}),
        source_payload: rawPayload,
        ...(index === lastCashIndex ? { pos_change_returned: change.change.toFixed(2) } : {}),
        ...((payment?.provider_response ?? payment?.providerResponse) == null
          ? {}
          : { provider_response: payment.provider_response ?? payment.providerResponse }),
        ...(suppliedLocalId == null ? { generated_local_id: true } : {}),
        ...(deviceId == null || String(deviceId).trim() === '' ? { device_id_missing_source: true } : {}),
      };

      return [
        orderId,
        order.merchantId,
        order.storeId,
        localId == null ? null : String(localId),
        payment?.client_order_id ?? payment?.clientOrderId ?? storeOrder.clientOrderId ?? null,
        deviceId == null || String(deviceId).trim() === '' ? null : String(deviceId).trim(),
        payment?.shift_id ?? payment?.shiftId ?? storeOrder.shiftId ?? null,
        payment?.user_id ?? payment?.userId ?? payment?.cashier_id ?? payment?.cashierId ?? storeOrder.placedBy ?? null,
        payment?.payment_type ?? payment?.paymentType ?? 'pos_payment',
        method,
        payment?.payment_method_title ?? payment?.paymentMethodTitle ?? payment?.method_title ?? payment?.methodTitle ??
          sourcePayload?.payment_method_title ?? orderData?.paymentMethodTitle ?? storeOrder.paymentMethodTitle ?? null,
        capturedAmount,
        orderTotal,
        remaining,
        0,
        String(payment?.currency ?? orderData?.currency ?? '').trim().toUpperCase() || null,
        String(payment?.status ?? (orderData?.paymentStatus === PaymentStatus.PENDING ? 'pending' : 'completed'))
          .trim().toLowerCase(),
        'payment',
        payment?.provider ?? null,
        payment?.provider_transaction_id ?? payment?.providerTransactionId ?? payment?.transaction_id ?? payment?.transactionId ?? null,
        paymentAt.toISOString(),
        JSON.stringify(metadata),
      ];
    });
  }

  /**
   * WooCommerce normally resolves a product id into its price and tax rules before
   * creating an order. The compatibility endpoint must do the same because POS
   * clients commonly send only product_id and quantity.
   */
  private async enrichWooCommerceCreateOrder(orderData: any, sourcePayload: any): Promise<void> {
    const lines = Array.isArray(sourcePayload?.line_items) ? sourcePayload.line_items : null;
    if (!lines || !this.dataSource || !orderData.storeId) return;

    const productIds = [...new Set(lines
      .map((line: any) => String(line?.product_id ?? '').trim())
      .filter(Boolean))];
    if (!productIds.length) return;

    const productRows: Array<{ id?: string; product?: Record<string, unknown> }> = await this.dataSource.query(
      `SELECT product->>'id' AS id, product
         FROM public.store_products AS catalog
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(catalog.payload) = 'array' THEN catalog.payload
             WHEN jsonb_typeof(catalog.payload->'products') = 'array' THEN catalog.payload->'products'
             ELSE '[]'::jsonb
           END
         ) AS product
        WHERE catalog.store_id = $1::uuid
          AND COALESCE(catalog.is_deleted, false) = false
          AND product->>'id' = ANY($2::text[])`,
      [orderData.storeId, productIds],
    );
    const products = new Map(productRows.map((row) => [String(row.id), row.product || {}]));
    const unresolved = lines.filter((line: any) => {
      const id = String(line?.product_id ?? '').trim();
      const hasAmount = line?.total !== undefined || line?.subtotal !== undefined || line?.unitPrice !== undefined;
      return id && !products.has(id) && !hasAmount;
    });
    if (unresolved.length) {
      const ids = unresolved.map((line: any) => String(line.product_id)).join(', ');
      throw new BadRequestException(
        `Products ${ids} were not found in the store catalog. Sync the store products or send line subtotal/total explicitly.`,
      );
    }

    let taxSetting: any = null;
    let taxClasses: Array<{ name: string; rate: number | string }> = [];
    try {
      const configurations: Array<{ configuration_value?: Record<string, any> }> = await this.dataSource.query(
        `SELECT configuration_value
           FROM public.store_pos_configurations
          WHERE store_id = $1::uuid
            AND configuration_name = 'currency_taxes'
          LIMIT 1`,
        [orderData.storeId],
      );
      const configured = configurations[0]?.configuration_value;
      if (configured && typeof configured === 'object') {
        taxSetting = configured;
        taxClasses = Array.isArray(configured.taxClasses) ? configured.taxClasses : [];
      }
    } catch (error: unknown) {
      const code = error && typeof error === 'object'
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (code !== '42P01' && code !== '42703') throw error;
    }

    const places = Number(taxSetting?.decimalPlaces ?? 2);
    const factor = 10 ** places;
    const taxClassKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    const classRates = new Map(taxClasses.map((entry) => [taxClassKey(entry.name), Number(entry.rate || 0)]));
    const defaultRate = taxSetting?.taxEnabled === false ? 0 : Number(taxSetting?.defaultTaxRate || 0);
    const explicitTax = sourcePayload.total_tax !== undefined || (Array.isArray(sourcePayload.tax_lines) && sourcePayload.tax_lines.length > 0);
    const taxGroups = new Map<number, number>();
    const pendingTax: Array<{ line: any; rate: number; units: number; subtotalUnits?: number }> = [];
    let normalizedCustomItem = false;

    lines.forEach((line: any) => {
      const customNormalization = this.normalizeCustomItemQuantity(line, places);
      normalizedCustomItem ||= customNormalization.applied;
      const product = products.get(String(line?.product_id ?? '').trim());
      if (!product) {
        if (String(line?.type || '').trim().toLowerCase() !== 'custom') return;
        const taxClass = taxClassKey(line.tax_class);
        const rate = taxClass ? (classRates.get(taxClass) ?? defaultRate) : defaultRate;
        const existingTax = Number(line.total_tax);
        if (Number.isFinite(existingTax)) {
          if (customNormalization.applied) {
            // WooCommerce line amounts and taxes are quantity-extended values. The POS
            // custom-item contract supplies unit values, so extend them exactly once here.
            const previousSubtotalTax = Number(line.subtotal_tax ?? existingTax);
            const subtotalTax = previousSubtotalTax * customNormalization.quantity;
            const totalTax = existingTax * customNormalization.quantity;
            line.subtotal_tax = subtotalTax.toFixed(places);
            line.total_tax = totalTax.toFixed(places);
            line.taxes = rate > 0 ? [{ id: rate, total: line.total_tax, subtotal: line.subtotal_tax }] : [];
            const taxDeltaMinor = Math.round((totalTax - existingTax) * factor);
            if (taxDeltaMinor) taxGroups.set(rate, (taxGroups.get(rate) || 0) + taxDeltaMinor);
          }
          return;
        }
        const subtotalMinor = Math.round(Number(line.subtotal || 0) * factor);
        const totalMinor = Math.round(Number(line.total || 0) * factor);
        if (!(rate > 0)) {
          line.subtotal_tax = (0).toFixed(places);
          line.total_tax = (0).toFixed(places);
          line.taxes = [];
          return;
        }
        pendingTax.push({
          line,
          rate,
          units: taxUnitsForMinor(totalMinor, rate),
          subtotalUnits: subtotalMinor === totalMinor ? undefined : taxUnitsForMinor(subtotalMinor, rate),
        });
        return;
      }
      const quantity = Number(line.quantity || 1);
      const price = Number(product.price ?? product.sale_price ?? product.regular_price ?? 0);
      if (line.name === undefined) line.name = String(product.name || 'Sales Item');
      if (line.subtotal === undefined) line.subtotal = (price * quantity).toFixed(places);
      if (line.total === undefined) line.total = String(line.subtotal);
      if (line.tax_class === undefined) line.tax_class = String(product.tax_class || '');

      if (explicitTax) return;
      if (!isTaxableSaleLine(line)) {
        line.subtotal_tax = (0).toFixed(places);
        line.total_tax = (0).toFixed(places);
        line.taxes = [];
        return;
      }
      const taxable = String(product.tax_status || '').toLowerCase() === 'taxable';
      const taxClass = taxClassKey(product.tax_class);
      const rate = taxable ? (taxClass ? (classRates.get(taxClass) ?? defaultRate) : defaultRate) : 0;
      const taxableMinor = Math.round(Number(line.total || 0) * factor);
      if (!(rate > 0) || !taxableMinor) {
        line.subtotal_tax = (0).toFixed(places);
        line.total_tax = (0).toFixed(places);
        line.taxes = [];
        return;
      }
      pendingTax.push({ line, rate, units: taxUnitsForMinor(taxableMinor, rate) });
    });

    const pendingByRate = new Map<number, typeof pendingTax>();
    pendingTax.forEach((entry) => {
      const group = pendingByRate.get(entry.rate) || [];
      group.push(entry);
      pendingByRate.set(entry.rate, group);
    });
    pendingByRate.forEach((group, rate) => {
      const allocated = allocateRoundedTax(group.map((entry) => entry.units));
      const minor = allocated.reduce((sum, value) => sum + value, 0);
      group.forEach((entry, index) => {
        const lineMinor = allocated[index];
        const subtotalMinor = entry.subtotalUnits === undefined
          ? lineMinor
          : allocateRoundedTax([entry.subtotalUnits])[0];
        entry.line.total_tax = (lineMinor / factor).toFixed(places);
        entry.line.subtotal_tax = (subtotalMinor / factor).toFixed(places);
        entry.line.taxes = lineMinor
          ? [{ id: rate, total: entry.line.total_tax, subtotal: entry.line.subtotal_tax }]
          : [];
      });
      if (minor) taxGroups.set(rate, (taxGroups.get(rate) || 0) + minor);
    });

    if (!explicitTax) {
      sourcePayload.tax_lines = [...taxGroups.entries()].map(([rate, minor], index) => ({
        id: index + 1,
        rate_code: `POS-TAX-${index + 1}`,
        rate_id: index + 1,
        label: 'Tax',
        compound: false,
        tax_total: (minor / factor).toFixed(places),
        shipping_tax_total: (0).toFixed(places),
        rate_percent: rate,
        meta_data: [],
      }));
      sourcePayload.total_tax = ([...taxGroups.values()].reduce((sum, minor) => sum + minor, 0) / factor).toFixed(places);
      sourcePayload.cart_tax = sourcePayload.total_tax;
    } else if (taxGroups.size) {
      const addedTax = [...taxGroups.values()].reduce((sum, minor) => sum + minor, 0) / factor;
      sourcePayload.total_tax = (Number(sourcePayload.total_tax || 0) + addedTax).toFixed(places);
      sourcePayload.cart_tax = sourcePayload.total_tax;
      const existingTaxLines = Array.isArray(sourcePayload.tax_lines) ? sourcePayload.tax_lines : [];
      taxGroups.forEach((minor, rate) => {
        const amount = minor / factor;
        const matching = existingTaxLines.find((line: any) => Number(line?.rate_percent) === rate);
        if (matching) {
          matching.tax_total = (Number(matching.tax_total || 0) + amount).toFixed(places);
        } else {
          const id = existingTaxLines.length + 1;
          existingTaxLines.push({
            id,
            rate_code: `POS-TAX-${id}`,
            rate_id: id,
            label: 'Tax',
            compound: false,
            tax_total: amount.toFixed(places),
            shipping_tax_total: (0).toFixed(places),
            rate_percent: rate,
            meta_data: [],
          });
        }
      });
      sourcePayload.tax_lines = existingTaxLines;
    }

    const sourceFees = Array.isArray(sourcePayload.fee_lines) ? sourcePayload.fee_lines : [];
    const representedCoupon = representedCouponDiscount(lines, sourceFees, places);
    const calculationFees = feeLinesForCalculation(lines, sourceFees, places);
    const authoritativeCoupon = authoritativeCouponDiscount(
      Array.isArray(sourcePayload.coupon_lines) ? sourcePayload.coupon_lines : [],
      sourceFees,
      places,
      lines,
    );
    applyCouponDiscountToStoredLinesAndTax(
      lines,
      authoritativeCoupon > 0
        ? [{ code: 'stored-coupon-discount', discount: authoritativeCoupon.toFixed(places) }]
        : [],
      sourcePayload,
      places,
      representedCoupon,
    );
    applyMerchantDiscountToStoredTax(
      lines,
      calculationFees,
      sourcePayload,
      places,
    );

    const couponDiscount = authoritativeCoupon;
    if (couponDiscount > 0 && Array.isArray(sourcePayload.fee_lines)) {
      sourcePayload.fee_lines = sourcePayload.fee_lines.map((fee: any) => {
        const name = String(fee?.name || fee?.fee_name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        return name === 'coupon_discount'
          ? { ...fee, total: (-couponDiscount).toFixed(places) }
          : fee;
      });
    }

    const subtotal = lines.reduce((sum: number, line: any) => sum + Number(line.subtotal ?? line.total ?? 0), 0);
    const lineTotal = lines.reduce((sum: number, line: any) => sum + Number(line.total ?? line.subtotal ?? 0), 0);
    const feeTotal = effectiveFeeTotal(
      calculationFees,
      places,
    );
    const taxTotal = Number(sourcePayload.total_tax || 0);
    const shippingTotal = Number(sourcePayload.shipping_total || 0);
    if (sourcePayload.subtotal === undefined || normalizedCustomItem) sourcePayload.subtotal = subtotal.toFixed(places);
    const netBeforeTax = lineTotal + feeTotal + shippingTotal;
    sourcePayload.total = orderTotalWithTax({
      netBeforeTax,
      tax: taxTotal,
      pricesIncludeTax: Boolean(sourcePayload.prices_include_tax),
      decimalPlaces: places,
    }).toFixed(places);

    orderData.items = lines.map((line: any) => {
      const quantity = Number(line.quantity || 1);
      const total = Number(line.total ?? line.subtotal ?? 0);
      return {
        productId: String(line.product_id ?? ''),
        productName: line.name || 'Sales Item',
        quantity,
        unitPrice: quantity ? Number(line.subtotal ?? total) / quantity : 0,
        totalPrice: total,
        modifiers: Array.isArray(line.meta_data) ? line.meta_data : [],
      };
    });
    orderData.subtotal = subtotal;
    orderData.taxAmount = taxTotal;
    orderData.totalAmount = Number(sourcePayload.total);
    orderData.requestPayload = sourcePayload;
  }

  private async cashbackFeeForAmount(storeId: string, amount: number): Promise<number> {
    if (!this.dataSource || amount <= 0) return 0;
    try {
      const rows: Array<{ configuration_value?: Record<string, any> }> = await this.dataSource.query(
        `SELECT configuration_value
           FROM public.store_pos_configurations
          WHERE store_id = $1::uuid
            AND configuration_name = 'cashback_settings'
          LIMIT 1`,
        [storeId],
      );
      const settings = rows[0]?.configuration_value;
      if (!settings || settings.enabled === false) return 0;
      const maxCashback = Number(settings.maxCashback ?? settings.max_cashback ?? 0);
      if (maxCashback > 0 && amount > maxCashback) return 0;
      const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];
      const match = tiers.find((tier: Record<string, any>) => {
        const from = Number(tier.from ?? tier.fromAmount);
        const to = Number(tier.to ?? tier.toAmount);
        return Number.isFinite(from) && Number.isFinite(to) && amount >= from && amount <= to;
      });
      return Number(match?.fee || 0);
    } catch {
      return 0;
    }
  }

  private async migrateLegacyOrderIdsBeforeOrm(): Promise<void> {
    const migrationDataSource = new DataSource({
      ...postgresConnectionOptions([]),
      synchronize: false,
      logging: false,
    });
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(724621, 72)');
        const table = await manager.query(
          `SELECT to_regclass('public.orders') AS orders_table`,
        );
        if (!table[0]?.orders_table) return;
        const type = await manager.query(
          `SELECT data_type
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'id'`,
        );
        if (type[0]?.data_type === 'uuid') return;
        await manager.query(`
          CREATE TEMP TABLE order_uuid_migration (
            old_id varchar PRIMARY KEY,
            new_id uuid NOT NULL DEFAULT gen_random_uuid()
          ) ON COMMIT DROP
        `);
        await manager.query(`
          INSERT INTO order_uuid_migration (old_id)
          SELECT id FROM public.orders
          ON CONFLICT DO NOTHING
        `);
        await manager.query(`
          UPDATE public.order_line_items AS item
          SET "orderId" = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE item."orderId" = mapping.old_id
        `);
        await manager.query(`
          UPDATE public.order_status_history AS history
          SET "orderId" = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE history."orderId" = mapping.old_id
        `);
        await manager.query(`
          UPDATE public.orders AS orders
          SET id = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE orders.id = mapping.old_id
        `);
        await manager.query(`
          ALTER TABLE public.orders
            ALTER COLUMN id TYPE uuid USING id::uuid,
            ALTER COLUMN id SET DEFAULT gen_random_uuid()
        `);
        await manager.query(`
          ALTER TABLE public.order_line_items
            ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
        `);
        await manager.query(`
          ALTER TABLE public.order_status_history
            ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
        `);
      });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  private async migrateOrderColumnsToSnakeCase(): Promise<void> {
    const migrationDataSource = new DataSource({
      ...postgresConnectionOptions([]),
      synchronize: false,
      logging: false,
    });
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(724621, 73)');
        const tables = await manager.query(`SELECT to_regclass('public.orders') AS orders_table`);
        if (!tables[0]?.orders_table) return;
        const renames: Array<[string, string, string]> = [
          ['orders', 'orderNumber', 'order_number'],
          ['orders', 'merchantId', 'merchant_id'],
          ['orders', 'storeId', 'store_id'],
          ['orders', 'shiftId', 'shift_id'],
          ['orders', 'localShiftId', 'local_shift_id'],
          ['orders', 'clientOrderId', 'client_order_id'],
          ['orders', 'requestPayload', 'request_payload'],
          ['orders', 'customerName', 'customer_name'],
          ['orders', 'customerPhone', 'customer_phone'],
          ['orders', 'orderType', 'order_type'],
          ['orders', 'paymentMethod', 'payment_method'],
          ['orders', 'paymentStatus', 'payment_status'],
          ['orders', 'taxAmount', 'tax_amount'],
          ['orders', 'discountAmount', 'discount_amount'],
          ['orders', 'tipAmount', 'tip_amount'],
          ['orders', 'totalAmount', 'total_amount'],
          ['orders', 'orderStatus', 'order_status'],
          ['orders', 'createdAt', 'created_at'],
          ['orders', 'updatedAt', 'updated_at'],
          ['order_line_items', 'orderId', 'order_id'],
          ['order_line_items', 'productId', 'product_id'],
          ['order_line_items', 'productName', 'product_name'],
          ['order_line_items', 'unitPrice', 'unit_price'],
          ['order_line_items', 'totalPrice', 'total_price'],
          ['order_status_history', 'orderId', 'order_id'],
          ['order_status_history', 'fromStatus', 'from_status'],
          ['order_status_history', 'toStatus', 'to_status'],
          ['order_status_history', 'changedBy', 'changed_by'],
          ['order_status_history', 'createdAt', 'created_at'],
        ];
        for (const [table, oldName, newName] of renames) {
          await manager.query(`
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${oldName}')
                 AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${newName}') THEN
                ALTER TABLE public."${table}" RENAME COLUMN "${oldName}" TO "${newName}";
              END IF;
            END $$
          `);
        }
        await manager.query(`
          DO $$ BEGIN
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='merchant_id') <> 'uuid' THEN
              ALTER TABLE public.orders ALTER COLUMN merchant_id TYPE uuid USING merchant_id::uuid;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='store_id') <> 'uuid' THEN
              ALTER TABLE public.orders ALTER COLUMN store_id TYPE uuid USING store_id::uuid;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='shift_id') <> 'character varying' THEN
              ALTER TABLE public.orders ALTER COLUMN shift_id DROP DEFAULT;
              ALTER TABLE public.orders ALTER COLUMN shift_id TYPE varchar(100) USING shift_id::text;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='created_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.orders ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.orders ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='order_status_history' AND column_name='created_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.order_status_history ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
            END IF;
          END $$
        `);
      });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  private async ensureStoreOrdersTable(): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.store_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL,
        merchant_id uuid NOT NULL,
        store_id uuid NOT NULL,
        client_order_id varchar(150),
        device_id varchar(150),
        placed_by varchar(100),
        shift_id varchar(100),
        currency varchar(10) NOT NULL DEFAULT 'USD',
        timezone varchar(100) NOT NULL DEFAULT 'UTC',
        payment_method varchar(50),
        payment_method_title varchar(150),
        set_paid boolean NOT NULL DEFAULT false,
        status varchar(50) NOT NULL DEFAULT 'processing',
        pay_later boolean NOT NULL DEFAULT false,
        pay_later_user_id varchar(100),
        subtotal numeric(12,2) NOT NULL DEFAULT 0,
        discount_total numeric(12,2) NOT NULL DEFAULT 0,
        fee_total numeric(12,2) NOT NULL DEFAULT 0,
        tax_total numeric(12,2) NOT NULL DEFAULT 0,
        total numeric(12,2) NOT NULL DEFAULT 0,
        grand_total numeric(12,2) NOT NULL DEFAULT 0,
        line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
        fee_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
        coupon_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
        tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
        payments jsonb NOT NULL DEFAULT '[]'::jsonb,
        meta_data jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'store_orders'
             AND column_name = 'final_total'
        ) AND NOT EXISTS (
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'store_orders'
             AND column_name = 'grand_total'
        ) THEN
          ALTER TABLE public.store_orders RENAME COLUMN final_total TO grand_total;
        END IF;
      END $$;

      ALTER TABLE public.store_orders
        ADD COLUMN IF NOT EXISTS grand_total numeric(12,2) NOT NULL DEFAULT 0;
    `);
    await this.ensureClientOrderUniqueIndex(
      'store_orders_store_client_order_idx',
      'store_orders_store_client_order_uidx',
      'public.store_orders (store_id, client_order_id)',
    );
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS store_orders_order_id_idx
      ON public.store_orders (order_id)
    `);
    await this.consolidateDuplicateTables();
  }

  private async ensurePosOrderColumns(): Promise<void> {
    if (!this.dataSource) return;
    const table = await this.dataSource.query(`SELECT to_regclass('public.orders') AS orders_table`);
    if (!table[0]?.orders_table) return;
    await this.dataSource.query(`
      ALTER TABLE public.orders
        ADD COLUMN IF NOT EXISTS local_shift_id varchar(100),
        ADD COLUMN IF NOT EXISTS client_order_id varchar(150),
        ADD COLUMN IF NOT EXISTS offline boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS metadata jsonb,
        ADD COLUMN IF NOT EXISTS request_payload jsonb
    `);
    await this.ensureClientOrderUniqueIndex(
      'orders_store_client_order_id_idx',
      'orders_store_client_order_id_uidx',
      'public.orders (store_id, client_order_id)',
    );
  }

  private async ensureClientOrderUniqueIndex(plainName: string, uniqueName: string, target: string): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(`DROP INDEX IF EXISTS public.${plainName}`);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${uniqueName}
        ON ${target}
        WHERE client_order_id IS NOT NULL
      `);
    } catch (error) {
      console.error(`Unique client order index ${uniqueName} was not created`, error);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS ${plainName}
        ON ${target}
      `);
    }
  }

  private async ensureOrderUuidSchema(): Promise<void> {
    if (!this.dataSource) return;
    const columns = await this.dataSource.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'orders' AND column_name = 'id')
           OR (table_name IN ('order_line_items', 'order_status_history') AND column_name = 'order_id'))`,
    );
    if (!columns.some((column: { table_name: string }) => column.table_name === 'orders')) return;
    if (columns.length && columns.every((column: { data_type: string }) => column.data_type === 'uuid')) {
      return;
    }
    await this.dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 72)');
      await manager.query(`
        CREATE TEMP TABLE order_uuid_migration (
          old_id varchar PRIMARY KEY,
          new_id uuid NOT NULL DEFAULT gen_random_uuid()
        ) ON COMMIT DROP
      `);
      await manager.query(`
        INSERT INTO order_uuid_migration (old_id)
        SELECT id FROM public.orders
        WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ON CONFLICT DO NOTHING
      `);
      await manager.query(`
        UPDATE public.order_line_items AS item
        SET "orderId" = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE item."orderId" = mapping.old_id
      `);
      await manager.query(`
        UPDATE public.order_status_history AS history
        SET "orderId" = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE history."orderId" = mapping.old_id
      `);
      await manager.query(`
        UPDATE public.orders AS orders
        SET id = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE orders.id = mapping.old_id
      `);
      await manager.query(`
        ALTER TABLE public.orders
          ALTER COLUMN id TYPE uuid USING id::uuid,
          ALTER COLUMN id SET DEFAULT gen_random_uuid()
      `);
      await manager.query(`
        ALTER TABLE public.order_line_items
          ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
      `);
      await manager.query(`
        ALTER TABLE public.order_status_history
          ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
      `);
    });
  }

  async updateOrderStatus(orderId: string, toStatus: OrderStatus, changedBy: string, reason?: string): Promise<OrderEntity | null> {
    const normalizedStatus = String(toStatus || '').trim().replace(/-/g, '_').toUpperCase() as OrderStatus;
    if (!Object.values(OrderStatus).includes(normalizedStatus)) {
      throw new BadRequestException(`Invalid order status '${String(toStatus || '')}'`);
    }
    if (this.isDbConnected && this.storeOrderRepo) {
      const graph = await this.getOrderByReference(orderId);
      const storeOrder = graph?.storeOrder;
      if (!storeOrder) return null;
      if (String(storeOrder.orderStatus).toUpperCase() === OrderStatus.CANCELLED
        && normalizedStatus !== OrderStatus.CANCELLED) {
        throw new ConflictException('Cancelled orders cannot change status');
      }
      const internalOrderId = storeOrder.orderId;
      const fromStatus = storeOrder.orderStatus;
      storeOrder.orderStatus = normalizedStatus;
      storeOrder.status = normalizedStatus.toLowerCase().replace(/_/g, '-');
      storeOrder.requestPayload = {
        ...(storeOrder.requestPayload || {}),
        status: storeOrder.status,
      };
      storeOrder.updatedAt = new Date();
      storeOrder.statusHistory = [...(Array.isArray(storeOrder.statusHistory) ? storeOrder.statusHistory : []), {
        id: `HST-${randomUUID()}`,
        orderId: internalOrderId,
        fromStatus,
        toStatus: normalizedStatus,
        changedBy: changedBy || 'POS System',
        reason: reason || 'State Machine Transition',
        createdAt: new Date(),
      }];
      const saved = await this.storeOrderRepo.save(storeOrder);
      const history = storeOrder.statusHistory[storeOrder.statusHistory.length - 1] as OrderStatusHistoryEntity;
      if (this.historyRepo) await this.historyRepo.save(this.historyRepo.create(history));
      const order = this.projectOrder(saved);
      await this.cacheOrder(order);
      return order;
    }
    const graph = await this.getOrderByReference(orderId);
    const order = graph?.order || null;
    if (!order) return null;
    if (String(order.orderStatus).toUpperCase() === OrderStatus.CANCELLED
      && normalizedStatus !== OrderStatus.CANCELLED) {
      throw new ConflictException('Cancelled orders cannot change status');
    }
    order.orderStatus = normalizedStatus;
    order.requestPayload = {
      ...(order.requestPayload || {}),
      status: normalizedStatus.toLowerCase().replace(/_/g, '-'),
    };
    await this.cacheOrder(order);
    return order;
  }

  async saveOrderMutation(input: {
    order: OrderEntity;
    items: OrderItemEntity[];
    storeOrder: StoreOrderEntity | null;
    replaceItems: boolean;
    history?: { fromStatus: string; toStatus: string; changedBy: string; reason?: string };
  }): Promise<{ order: OrderEntity; items: OrderItemEntity[]; storeOrder: StoreOrderEntity | null }> {
    if (!this.isDbConnected || !this.dataSource || !input.storeOrder) {
      throw new ServiceUnavailableException('Order database is unavailable; the order was not updated');
    }
    const storeOrder = input.storeOrder;
    storeOrder.orderStatus = input.order.orderStatus;
    storeOrder.subtotal = input.order.subtotal;
    storeOrder.taxTotal = input.order.taxAmount;
    storeOrder.tipAmount = input.order.tipAmount;
    storeOrder.total = input.order.totalAmount;
    const lineItems = Array.isArray(storeOrder.lineItems) ? storeOrder.lineItems as any[] : [];
    const couponLines = Array.isArray(storeOrder.couponLines) ? storeOrder.couponLines as any[] : [];
    const feeLines = Array.isArray(storeOrder.feeLines) ? storeOrder.feeLines as any[] : [];
    const taxLines = Array.isArray(storeOrder.taxLines) ? storeOrder.taxLines as any[] : [];
    const payload = (storeOrder.requestPayload || input.order.requestPayload || {}) as Record<string, unknown>;
    storeOrder.discountTotal = calculateDiscountTotal(lineItems, couponLines, feeLines);
    storeOrder.grandTotal = listOrderTotal({
      total: storeOrder.total,
      tax: storeOrder.taxTotal,
      taxLines,
      couponDiscount: sumCouponDiscounts(couponLines),
      lineItems,
      feeLines,
      shippingTotal: payload.shipping_total ?? payload.shippingTotal,
      tip: storeOrder.tipAmount,
    });
    storeOrder.paymentStatus = input.order.paymentStatus;
    storeOrder.updatedAt = new Date();
    if (input.history) {
      storeOrder.statusHistory = [...(Array.isArray(storeOrder.statusHistory) ? storeOrder.statusHistory : []), {
        id: `HST-${randomUUID()}`,
        orderId: input.order.id,
        fromStatus: input.history.fromStatus,
        toStatus: input.history.toStatus,
        changedBy: input.history.changedBy || 'POS System',
        reason: input.history.reason || 'Order update',
        createdAt: new Date(),
      }];
    }
    const saved = await this.dataSource.transaction(async manager => {
      const storeOrderRepository = manager.getRepository(StoreOrderEntity);
      const persisted = await storeOrderRepository.save(storeOrderRepository.create({ ...storeOrder }));
      if (input.replaceItems) await this.saveLineItems(manager, input.order.id, input.items, true);
      if (input.history) {
        const history = storeOrder.statusHistory[storeOrder.statusHistory.length - 1] as OrderStatusHistoryEntity;
        await this.saveStatusHistory(manager, history);
      }
      return persisted;
    });
    const order = this.projectOrder(saved);
    await this.cacheOrder(order);
    return { order, items: this.itemsFromStore(saved), storeOrder: saved };
  }

  async replaceOrderSnapshot(
    orderReference: string,
    source: Record<string, unknown>,
    scope: { storeId?: string; merchantId?: string } = {},
  ) {
    if (!this.isDbConnected || !this.dataSource || !this.storeOrderRepo) {
      throw new ServiceUnavailableException('Order database is unavailable; the order was not updated');
    }
    const current = await this.getOrderByReference(orderReference);
    if (!current?.storeOrder) throw new BadRequestException(`Order '${orderReference}' was not found`);
    if (scope.storeId && current.order.storeId !== scope.storeId) {
      throw new BadRequestException(`Order '${orderReference}' does not belong to store '${scope.storeId}'`);
    }
    if (scope.merchantId && current.order.merchantId !== scope.merchantId) {
      throw new BadRequestException(`Order '${orderReference}' does not belong to merchant '${scope.merchantId}'`);
    }

    const payload: any = JSON.parse(JSON.stringify(source || {}));
    const sourceItems = Array.isArray(payload.line_items) ? payload.line_items : payload.items;
    if (!Array.isArray(sourceItems) || !sourceItems.length) {
      throw new BadRequestException('line_items with at least 1 item are required to replace an order');
    }
    const metadata = Array.isArray(payload.meta_data) ? payload.meta_data : [];
    const metaValue = (key: string) => metadata.find((entry: any) => entry?.key === key)?.value;
    let items: OrderItemEntity[] = sourceItems.map((item: any, index: number) => {
      const quantity = Number(item?.quantity || 1);
      const lineTotal = Number(item?.total ?? item?.subtotal ?? item?.totalPrice ?? 0);
      return {
        id: String(item?.id || `ITEM-${current.order.id}-${index + 1}`),
        orderId: current.order.id,
        productId: String(item?.product_id ?? item?.productId ?? ''),
        productName: String(item?.name || item?.productName || 'Sales Item'),
        quantity,
        unitPrice: item?.unitPrice !== undefined ? Number(item.unitPrice) : (quantity ? lineTotal / quantity : 0),
        totalPrice: lineTotal,
        modifiers: Array.isArray(item?.meta_data) ? item.meta_data : item?.modifiers || [],
      };
    });
    const requestedStatus = String(payload.status || current.storeOrder.status || 'processing')
      .trim().toLowerCase().replace(/_/g, '-');
    const orderStatus = requestedStatus === 'completed'
      ? OrderStatus.COMPLETED
      : requestedStatus === 'refunded'
        ? OrderStatus.REFUNDED
        : requestedStatus === 'cancelled' || requestedStatus === 'canceled'
          ? OrderStatus.CANCELLED
          : OrderStatus.CREATED;
    const paymentMethodText = String(payload.payment_method || current.storeOrder.paymentMethod || 'cash').toUpperCase();
    const orderData: any = {
      storeId: current.order.storeId,
      merchantId: current.order.merchantId,
      deviceId: String(metaValue('pos_device_id') ?? metaValue('_pos_device_id') ?? current.storeOrder.deviceId ?? '').trim() || undefined,
      shiftId: String(metaValue('shift_id') ?? current.storeOrder.shiftId ?? '').trim() || undefined,
      localShiftId: current.storeOrder.localShiftId,
      clientOrderId: String(metaValue('_pos_client_order_id') ?? current.storeOrder.clientOrderId ?? '').trim() || undefined,
      offline: Boolean(payload.offline ?? current.storeOrder.offline),
      metadata,
      requestPayload: payload,
      items: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        modifiers: item.modifiers,
      })),
      customerName: payload.customerName ?? current.order.customerName,
      customerPhone: payload.customerPhone ?? current.order.customerPhone,
      orderType: payload.orderType ?? current.order.orderType,
      paymentMethod: paymentMethodText.includes('CARD') ? PaymentMethod.CARD
        : paymentMethodText.includes('UPI') ? PaymentMethod.UPI
          : paymentMethodText.includes('CREDIT') ? PaymentMethod.STORE_CREDIT
            : PaymentMethod.CASH,
      paymentStatus: payload.set_paid === false ? PaymentStatus.PENDING : PaymentStatus.PAID,
      orderStatus,
      tipAmount: Number(payload.tipAmount ?? payload.tip_amount ?? current.order.tipAmount ?? 0),
      currency: current.storeOrder.currency,
      timezone: current.storeOrder.timezone,
      payments: Array.isArray(payload.payments) ? payload.payments : [],
    };
    await this.enrichWooCommerceCreateOrder(orderData, payload);
    items = (orderData.items || []).map((item: any, index: number) => ({
      id: String(sourceItems[index]?.id || `ITEM-${current.order.id}-${index + 1}`),
      orderId: current.order.id,
      productId: String(item.productId ?? ''),
      productName: String(item.productName || 'Sales Item'),
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unitPrice || 0),
      totalPrice: Number(item.totalPrice || 0),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
    }));
    const replacement = this.buildStoreOrder(current.order.id, orderData, payload);
    replacement.id = current.storeOrder.id;
    replacement.orderNumber = current.storeOrder.orderNumber;
    replacement.createdAt = current.storeOrder.createdAt;
    replacement.statusHistory = Array.isArray(current.storeOrder.statusHistory)
      ? [...current.storeOrder.statusHistory]
      : [];

    const previousStatus = String(current.order.orderStatus);
    if (previousStatus !== String(orderStatus)) {
      replacement.statusHistory.push({
        id: `HST-${randomUUID()}`,
        orderId: current.order.id,
        fromStatus: previousStatus,
        toStatus: String(orderStatus),
        changedBy: 'POS System',
        reason: 'Full order snapshot updated',
        createdAt: new Date(),
      });
    }
    const replacementOrder: OrderEntity = {
      ...current.order,
      shiftId: replacement.shiftId,
      localShiftId: replacement.localShiftId,
      clientOrderId: replacement.clientOrderId,
      offline: replacement.offline,
      metadata,
      requestPayload: payload,
      customerName: replacement.customerName,
      customerPhone: replacement.customerPhone,
      orderType: orderData.orderType,
      paymentMethod: orderData.paymentMethod,
      paymentStatus: orderData.paymentStatus,
      subtotal: replacement.subtotal,
      taxAmount: replacement.taxTotal,
      discountAmount: replacement.discountTotal,
      tipAmount: replacement.tipAmount,
      totalAmount: replacement.total,
      orderStatus,
      updatedAt: new Date(),
    };
    const paymentRows = this.buildStorePosPaymentRows(
      current.order.id,
      replacementOrder,
      orderData,
      payload,
      replacement,
    );

    const saved = await this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(StoreOrderEntity);
      const persisted = await repository.save(repository.create(replacement));
      await this.saveLineItems(manager, current.order.id, items, true);
      await manager.query(
        `DELETE FROM public.store_pos_payments
          WHERE order_id = $1::uuid AND entry_type = 'payment'`,
        [current.order.id],
      );
      if (paymentRows.length) {
        await manager.query(
          `INSERT INTO public.store_pos_payments (
             order_id, merchant_id, store_id, local_id, client_order_id, device_id,
             shift_id, user_id, payment_type, payment_method, payment_method_title,
             amount, order_total, remaining, refund_amount, currency, status, entry_type,
             provider, provider_transaction_id, payment_at, metadata
           ) VALUES ${paymentRows.map((_, index) => {
             const offset = index * 22;
             return `(${Array.from({ length: 22 }, (_value, column) => `$${offset + column + 1}`).join(', ')})`;
           }).join(', ')}`,
          paymentRows.flat(),
        );
      }
      await manager.query('DELETE FROM public.store_orders_meta WHERE order_id = $1::uuid', [current.order.id]);
      await this.saveStoreOrderMeta(manager, current.order.id, replacement.metadata, replacement.metaData);
      if (previousStatus !== String(orderStatus)) {
        await this.saveStatusHistory(
          manager,
          replacement.statusHistory[replacement.statusHistory.length - 1] as OrderStatusHistoryEntity,
        );
      }
      return persisted;
    });
    const order = this.projectOrder(saved);
    await this.cacheOrder(order);
    return { order, items: this.itemsFromStore(saved), storeOrder: saved };
  }

  async getOrderStatusCounts(criteria: {
    merchantId?: string;
    storeId?: string;
    page: number;
    perPage: number;
    statuses: string[];
    createdVia?: string;
    author?: string;
    after?: Date;
    before?: Date;
    orderBy?: 'created' | 'modified';
  }): Promise<{ total: number; statusCounts: Record<string, number> }> {
    if (!this.isDbConnected || !this.dataSource || !this.storeOrderRepo) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    const statuses = criteria.statuses.length ? criteria.statuses : null;
    const createdVia = criteria.createdVia?.trim().toLowerCase() || null;
    const author = criteria.author?.trim() || null;
    const merchantId = criteria.merchantId || null;
    const storeId = criteria.storeId || null;
    const params: unknown[] = [merchantId, storeId, statuses, createdVia, author, criteria.after || null, criteria.before || null];
    const effectiveStatus = `CASE
      WHEN upper(COALESCE(sale.order_status, '')) = 'REFUNDED'
        OR lower(COALESCE(sale.status, '')) = 'refunded'
        OR upper(COALESCE(sale.payment_status, '')) = 'REFUNDED'
        OR (sale.total > 0 AND payment_state.refunded_amount >= sale.total - 0.005)
        THEN 'refunded'
      WHEN upper(COALESCE(sale.order_status, '')) = 'CANCELLED'
        OR lower(COALESCE(sale.status, '')) = 'cancelled'
        OR lower(COALESCE(sale.request_payload->>'status', '')) = 'cancelled'
        THEN 'cancelled'
      WHEN payment_state.refunded_amount > 0
        OR upper(COALESCE(sale.order_status, '')) = 'PARTIAL_REFUND'
        OR lower(COALESCE(sale.status, '')) IN ('partial-refund', 'partially-refunded')
        THEN 'partial-refund'
      WHEN upper(COALESCE(sale.order_status, '')) = 'COMPLETED'
        OR lower(COALESCE(sale.status, '')) = 'completed'
        OR lower(COALESCE(sale.request_payload->>'status', '')) = 'completed'
        THEN 'completed'
      WHEN NULLIF(sale.status, '') IS NOT NULL THEN lower(sale.status)
      ELSE 'processing'
    END`;
    const where = `
      FROM public.store_orders AS sale
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(payment.refund_amount), 0)::numeric AS refunded_amount
          FROM public.store_pos_payments AS payment
         WHERE payment.order_id = sale.order_id
           AND payment.entry_type = 'payment'
           AND payment.is_void = false
           AND payment.deleted_at IS NULL
           AND lower(COALESCE(payment.status, 'completed')) NOT IN ('failed', 'cancelled')
      ) AS payment_state ON true
      WHERE ($1::uuid IS NULL OR sale.merchant_id = $1::uuid)
        AND ($2::uuid IS NULL OR sale.store_id = $2::uuid)
        AND (
          $3::text[] IS NULL
          OR (${effectiveStatus}) = ANY($3::text[])
        )
        AND (
          $4::text IS NULL
          OR lower(COALESCE(
            NULLIF(sale.request_payload->>'created_via', ''),
            NULLIF((
              SELECT entry->>'value'
              FROM jsonb_array_elements(COALESCE(sale.metadata, '[]'::jsonb)) AS entry
              WHERE entry->>'key' IN ('order_created_via', 'created_via')
              LIMIT 1
            ), ''),
            'rest-api'
          )) = $4
        )
        AND (
          $5::text IS NULL
          OR COALESCE(
            NULLIF(sale.placed_by, ''),
            NULLIF((
              SELECT entry->>'value'
              FROM jsonb_array_elements(COALESCE(sale.metadata, '[]'::jsonb)) AS entry
              WHERE entry->>'key' IN ('_wc_order_created_by', 'pos_placed_by', 'author')
              LIMIT 1
            ), ''),
            NULLIF(sale.request_payload->>'author', '')
          ) = $5
        )
        AND ($6::timestamptz IS NULL OR sale.updated_at >= $6::timestamptz)
        AND ($7::timestamptz IS NULL OR sale.updated_at <= $7::timestamptz)
    `;
    try {
        // Match the Orders screen's CREATED -> Pending Payment label without
        // reclassifying cancelled, completed or refunded orders as pending.
        const screenStatus = `CASE
          WHEN (${effectiveStatus}) IN ('completed','cancelled','refunded','partial-refund') THEN (${effectiveStatus})
          WHEN upper(COALESCE(sale.order_status,''))='CREATED' THEN 'pending'
          ELSE (${effectiveStatus}) END`;
        const counts: Array<{ status: string; total: number }> = await this.dataSource.query(
          `SELECT (${screenStatus}) AS status, COUNT(*)::int AS total ${where} GROUP BY 1`,
          params.map((value, index) => index === 2 ? null : value),
        );
        const statusCounts: Record<string, number> = { completed: 0, pending: 0, cancelled: 0, refunded: 0, partial_refund: 0 };
        let total = 0;
        for (const row of counts) {
          const count = Number(row.total);
          statusCounts[row.status.replace(/-/g, '_')] = count;
          if (!statuses || statuses.includes(row.status)) total += count;
        }
        return { total, statusCounts };
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
  }

  async getAdminOrderCounts(storeId: string | undefined, startDate?: string, endDate?: string) {
    if (!storeId?.trim()) throw new BadRequestException('store_id or x-store-id is required');
    for (const value of [startDate,endDate]) {
      if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new BadRequestException('Dates must be valid YYYY-MM-DD values');
    }
    if (endDate && !startDate) throw new BadRequestException('start_date is required with end_date');
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('end_date must not be before start_date');
    if (!this.isDbConnected || !this.dataSource) throw new ServiceUnavailableException('Order database is unavailable');
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      const [store] = await manager.query('SELECT store_name FROM public.stores WHERE id::text=$1 AND COALESCE(is_deleted,false)=false', [storeId.trim()]);
      if (!store) throw new NotFoundException('Store not found');
      const params = [storeId.trim(),startDate || null,endDate || startDate || null];
      const orders = await manager.query(
        `SELECT order_id,status,total,line_items FROM public.store_orders WHERE store_id::text=$1
         AND ($2::date IS NULL OR (created_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date)`, params,
      );
      const payments = await manager.query(
        `SELECT payment_method,amount,entry_type,payment_type,is_void,metadata FROM public.store_pos_payments WHERE store_id::text=$1 AND deleted_at IS NULL
         AND ($2::date IS NULL OR (COALESCE(payment_at,created_at) AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date)`, params,
      );
      const refunds = await manager.query(
        `WITH refund_rows AS (
          SELECT (event->>'amount')::numeric AS amount,COALESCE((event->>'created_at')::timestamptz,p.created_at) AS refunded_at
          FROM public.store_pos_payments p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.metadata->'refund_history','[]'::jsonb)) event
          WHERE p.store_id::text=$1 AND p.entry_type='payment' AND p.deleted_at IS NULL AND p.is_void=false
          UNION ALL
          SELECT amount,created_at FROM public.store_pos_payments WHERE store_id::text=$1 AND entry_type='refund' AND deleted_at IS NULL AND is_void=false
            AND COALESCE(metadata->>'daily_refund_tracking','false') NOT IN ('true','1')
          UNION ALL
          SELECT p.refund_amount,COALESCE(p.updated_at,p.created_at) FROM public.store_pos_payments p WHERE p.store_id::text=$1 AND p.entry_type='payment'
            AND p.deleted_at IS NULL AND p.is_void=false AND p.refund_amount>0 AND jsonb_array_length(COALESCE(p.metadata->'refund_history','[]'::jsonb))=0
            AND NOT EXISTS (SELECT 1 FROM public.store_pos_payments r WHERE r.order_id=p.order_id AND r.store_id=p.store_id
              AND r.entry_type='refund' AND r.deleted_at IS NULL AND r.is_void=false)
        ) SELECT amount FROM refund_rows WHERE ($2::date IS NULL OR (refunded_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date)`,params,
      );
      const tables = await manager.query("SELECT to_regclass('public.store_categories') AS categories,to_regclass('public.store_products') AS products");
      const categories = tables[0]?.categories ? await manager.query('SELECT payload FROM public.store_categories WHERE store_id::text=$1',[storeId.trim()]) : [];
      const products = tables[0]?.products ? await manager.query(
        `SELECT jsonb_agg(jsonb_build_object('id',product->'id','categories',product->'categories')) AS payload
         FROM public.store_products s CROSS JOIN LATERAL jsonb_array_elements(s.payload) product
         WHERE s.store_id::text=$1 AND COALESCE(s.is_deleted,false)=false`, [storeId.trim()],
      ) : [];
      return adminOrderCounts({ businessName: store.store_name, orders, payments, refunds, categories: categories.flatMap((row: any) => Array.isArray(row.payload) ? row.payload : []), products: products.flatMap((row: any) => Array.isArray(row.payload) ? row.payload : []) });
    });
  }

  async listOrders(criteria: {
    merchantId?: string;
    storeId?: string;
    page: number;
    perPage: number;
    statuses: string[];
    createdVia?: string;
    author?: string;
    after?: Date;
    before?: Date;
    orderBy?: 'created' | 'modified';
  }): Promise<{
    total: number;
    orders: Array<{
      order: OrderEntity;
      storeOrder: StoreOrderEntity | null;
      items: OrderItemEntity[];
      products: Map<string, unknown>;
      refunds: Array<{ amount: unknown; metadata: Record<string, unknown> | null }>;
      effectiveStatus: string;
    }>;
  }> {
    if (!this.isDbConnected || !this.dataSource || !this.storeOrderRepo) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    const statuses = criteria.statuses.length ? criteria.statuses : null;
    const createdVia = criteria.createdVia?.trim().toLowerCase() || null;
    const author = criteria.author?.trim() || null;
    const merchantId = criteria.merchantId || null;
    const storeId = criteria.storeId || null;
    const params: unknown[] = [merchantId, storeId, statuses, createdVia, author, criteria.after || null, criteria.before || null];
    const effectiveStatus = `CASE
      WHEN upper(COALESCE(sale.order_status, '')) = 'REFUNDED'
        OR lower(COALESCE(sale.status, '')) = 'refunded'
        OR upper(COALESCE(sale.payment_status, '')) = 'REFUNDED'
        OR (sale.total > 0 AND payment_state.refunded_amount >= sale.total - 0.005)
        THEN 'refunded'
      WHEN upper(COALESCE(sale.order_status, '')) = 'CANCELLED'
        OR lower(COALESCE(sale.status, '')) = 'cancelled'
        OR lower(COALESCE(sale.request_payload->>'status', '')) = 'cancelled'
        THEN 'cancelled'
      WHEN payment_state.refunded_amount > 0
        OR upper(COALESCE(sale.order_status, '')) = 'PARTIAL_REFUND'
        OR lower(COALESCE(sale.status, '')) IN ('partial-refund', 'partially-refunded')
        THEN 'partial-refund'
      WHEN upper(COALESCE(sale.order_status, '')) = 'COMPLETED'
        OR lower(COALESCE(sale.status, '')) = 'completed'
        OR lower(COALESCE(sale.request_payload->>'status', '')) = 'completed'
        THEN 'completed'
      WHEN NULLIF(sale.status, '') IS NOT NULL THEN lower(sale.status)
      ELSE 'processing'
    END`;
    const where = `
      FROM public.store_orders AS sale
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(payment.refund_amount), 0)::numeric AS refunded_amount
          FROM public.store_pos_payments AS payment
         WHERE payment.order_id = sale.order_id
           AND payment.entry_type = 'payment'
           AND payment.is_void = false
           AND payment.deleted_at IS NULL
           AND lower(COALESCE(payment.status, 'completed')) NOT IN ('failed', 'cancelled')
      ) AS payment_state ON true
      WHERE ($1::uuid IS NULL OR sale.merchant_id = $1::uuid)
        AND ($2::uuid IS NULL OR sale.store_id = $2::uuid)
        AND (
          $3::text[] IS NULL
          OR (${effectiveStatus}) = ANY($3::text[])
        )
        AND (
          $4::text IS NULL
          OR lower(COALESCE(
            NULLIF(sale.request_payload->>'created_via', ''),
            NULLIF((
              SELECT entry->>'value'
              FROM jsonb_array_elements(COALESCE(sale.metadata, '[]'::jsonb)) AS entry
              WHERE entry->>'key' IN ('order_created_via', 'created_via')
              LIMIT 1
            ), ''),
            'rest-api'
          )) = $4
        )
        AND (
          $5::text IS NULL
          OR COALESCE(
            NULLIF(sale.placed_by, ''),
            NULLIF((
              SELECT entry->>'value'
              FROM jsonb_array_elements(COALESCE(sale.metadata, '[]'::jsonb)) AS entry
              WHERE entry->>'key' IN ('_wc_order_created_by', 'pos_placed_by', 'author')
              LIMIT 1
            ), ''),
            NULLIF(sale.request_payload->>'author', '')
          ) = $5
        )
        AND ($6::timestamptz IS NULL OR sale.updated_at >= $6::timestamptz)
        AND ($7::timestamptz IS NULL OR sale.updated_at <= $7::timestamptz)
    `;
    let countRows: Array<{ total?: number }>;
    let idRows: Array<{ id: string; effective_status: string }>;
    try {
      countRows = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${where}`, params);
      const orderColumn = criteria.orderBy === 'modified' ? 'sale.updated_at' : 'sale.created_at';
      idRows = await this.dataSource.query(
        `SELECT sale.order_id AS id, (${effectiveStatus}) AS effective_status
           ${where}
          ORDER BY ${orderColumn} DESC, sale.order_id DESC
          LIMIT $8 OFFSET $9`,
        [...params, criteria.perPage, (criteria.page - 1) * criteria.perPage],
      );
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
    const total = Number(countRows[0]?.total || 0);
    const ids = idRows.map((row) => row.id);
    const effectiveStatusById = new Map(idRows.map((row) => [row.id, row.effective_status]));
    if (!ids.length) return { total, orders: [] };
    const storeOrders = await this.storeOrderRepo.find({ where: { orderId: In(ids) } });
    await this.applyStoredOrderMeta(storeOrders);
    const refundRows: Array<{
      order_id: string;
      amount: unknown;
      metadata: Record<string, unknown> | null;
    }> = await this.dataSource.query(
      `SELECT payment.order_id::text AS order_id,
              refund_event->>'amount' AS amount,
              refund_event AS metadata,
              COALESCE((refund_event->>'created_at')::timestamptz, payment.created_at) AS refunded_at
         FROM public.store_pos_payments AS payment
         CROSS JOIN LATERAL jsonb_array_elements(
           COALESCE(payment.metadata->'refund_history', '[]'::jsonb)
         ) AS refund_event
        WHERE payment.order_id = ANY($1::uuid[])
          AND payment.entry_type = 'payment'
          AND payment.is_void = false
          AND payment.deleted_at IS NULL
          AND lower(COALESCE(payment.status, 'completed')) NOT IN ('failed', 'cancelled')
        UNION ALL
       SELECT order_id::text, amount::text, metadata, created_at
         FROM public.store_pos_payments
        WHERE order_id = ANY($1::uuid[])
          AND entry_type = 'refund' AND is_void = false AND deleted_at IS NULL
          AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled', 'migrated')
          AND COALESCE(metadata->>'daily_refund_tracking', 'false') <> 'true'
        ORDER BY refunded_at ASC`,
      [ids],
    );
    const storeOrdersById = new Map(storeOrders.map((storeOrder) => [storeOrder.orderId, storeOrder]));
    const rows = ids.flatMap((id) => {
      const storeOrder = storeOrdersById.get(id);
      if (!storeOrder) return [];
      return [{
        order: this.projectOrder(storeOrder),
        storeOrder,
        items: this.itemsFromStore(storeOrder),
        effectiveStatus: effectiveStatusById.get(id) || 'processing',
        refunds: refundRows
          .filter((refund) => refund.order_id === id)
          .map(({ amount, metadata }) => ({ amount, metadata })),
      }];
    });
    await this.enrichCustomItemTaxesForListing(rows);
    const products = await this.catalogProducts(rows);
    return { total, orders: rows.map((row) => ({ ...row, products })) };
  }

  /**
   * Older/external POS orders can persist custom lines without WooCommerce tax
   * fields. Enrich only the total-orders read model from the line's category;
   * never rewrite the historical order or alter catalog-product taxation.
   */
  private async enrichCustomItemTaxesForListing(
    rows: Array<{ order: OrderEntity; storeOrder: StoreOrderEntity | null; items: OrderItemEntity[] }>,
  ): Promise<void> {
    if (!this.dataSource) return;
    const storeIds = [...new Set(rows.map((row) => row.order.storeId).filter(Boolean))];
    if (!storeIds.length) return;

    const categories: Array<{ store_id?: string; category?: Record<string, unknown> }> = await this.dataSource.query(
      `SELECT catalog.store_id::text AS store_id, category
         FROM public.store_categories AS catalog
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(catalog.payload, '[]'::jsonb)) AS category
        WHERE catalog.store_id = ANY($1::uuid[])
          AND COALESCE(catalog.is_deleted, false) = false`,
      [storeIds],
    );
    const rates = new Map<string, number>();
    categories.forEach((row) => {
      const category = row.category || {};
      const rate = Number(category.pos_tax_percent ?? category.posTaxPercent ?? category.rate);
      if (!row.store_id || !Number.isFinite(rate)) return;
      [category.id, category.wordpressId, category.wordpress_id, category.slug, category.name]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .forEach((key) => rates.set(`${row.store_id}:${key}`, rate));
    });

    rows.forEach(({ order, storeOrder }) => {
      if (!storeOrder || !Array.isArray(storeOrder.lineItems)) return;
      let enriched = false;
      let addedLineSubtotal = 0;
      let addedLineTotal = 0;
      const taxDeltaByRate = new Map<number, number>();
      storeOrder.lineItems.forEach((rawLine) => {
        const line = rawLine as any;
        if (String(line?.type || '').trim().toLowerCase() !== 'custom') return;
        const previousSubtotal = Number(line.subtotal ?? line.total ?? 0);
        const previousTotal = Number(line.total ?? line.subtotal ?? 0);
        const existingTax = Number(line?.total_tax ?? 0);
        this.normalizeCustomItemQuantity(line, 2);

        const categoryReference = line.category_id
          ?? line.categoryId
          ?? line.category?.id
          ?? line.categories?.[0]?.id
          ?? line.category_slug
          ?? line.categorySlug
          ?? line.category?.slug
          ?? line.category_name
          ?? line.categoryName
          ?? line.category?.name
          ?? line.tax_class
          ?? 'custom-product';
        const categoryKey = String(categoryReference).trim().toLowerCase();
        const rate = rates.get(`${order.storeId}:${categoryKey}`)
          ?? rates.get(`${order.storeId}:custom-product`);
        if (rate === undefined) return;

        const subtotal = Number(line.subtotal ?? line.total ?? 0);
        const total = Number(line.total ?? line.subtotal ?? 0);
        if (!Number.isFinite(subtotal) || !Number.isFinite(total)) return;
        const subtotalTax = Math.round(subtotal * rate) / 100;
        const totalTax = Math.round(total * rate) / 100;
        line.subtotal_tax = subtotalTax.toFixed(2);
        line.total_tax = totalTax.toFixed(2);
        line.taxes = [{ id: rate, total: line.total_tax, subtotal: line.subtotal_tax }];
        addedLineSubtotal += subtotal - (Number.isFinite(previousSubtotal) ? previousSubtotal : 0);
        addedLineTotal += total - (Number.isFinite(previousTotal) ? previousTotal : 0);
        taxDeltaByRate.set(
          rate,
          (taxDeltaByRate.get(rate) || 0) + totalTax - (Number.isFinite(existingTax) ? existingTax : 0),
        );
        enriched = true;
      });
      if (!enriched) return;
      const existingTaxLines = Array.isArray(storeOrder.taxLines)
        ? storeOrder.taxLines.map((line) => ({ ...(line as Record<string, unknown>) }))
        : [];
      taxDeltaByRate.forEach((amount, rate) => {
        const matchingLine = existingTaxLines.find(
          (line) => Number(line.rate_percent) === rate,
        );
        if (matchingLine) {
          const currentAmount = Number(matchingLine.tax_total ?? 0);
          matchingLine.tax_total = ((Number.isFinite(currentAmount) ? currentAmount : 0) + amount).toFixed(2);
          return;
        }
        const id = existingTaxLines.length + 1;
        existingTaxLines.push({
          id,
          rate_code: `POS-TAX-${id}`,
          rate_id: id,
          label: 'Tax',
          compound: false,
          tax_total: amount.toFixed(2),
          shipping_tax_total: '0.00',
          rate_percent: rate,
          meta_data: [],
        });
      });
      const storedTaxTotal = Number(storeOrder.taxTotal ?? 0);
      const addedTaxTotal = [...taxDeltaByRate.values()].reduce((sum, amount) => sum + amount, 0);
      storeOrder.taxTotal = (Number.isFinite(storedTaxTotal) ? storedTaxTotal : 0) + addedTaxTotal;
      const storedSubtotal = Number(storeOrder.subtotal ?? 0);
      storeOrder.subtotal = (Number.isFinite(storedSubtotal) ? storedSubtotal : 0) + addedLineSubtotal;
      const storedOrderTotal = Number(storeOrder.total ?? 0);
      storeOrder.total = (Number.isFinite(storedOrderTotal) ? storedOrderTotal : 0) + addedLineTotal;
      storeOrder.taxLines = existingTaxLines;
    });
  }

  private normalizeCustomItemQuantity(
    line: any,
    places: number,
  ): { applied: boolean; quantity: number } {
    if (String(line?.type || '').trim().toLowerCase() !== 'custom') {
      return { applied: false, quantity: 1 };
    }
    const quantity = Number(line.quantity || 1);
    if (!Number.isFinite(quantity) || quantity <= 1 || line._pch_quantity_applied === true) {
      return { applied: false, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 };
    }
    // Persist WooCommerce-compatible line totals while retaining the original unit
    // price and a marker that prevents total-orders from multiplying them again.
    const unitSubtotal = Number(line.subtotal ?? line.total ?? line.unit_price ?? line.unitPrice ?? 0);
    const unitTotal = Number(line.total ?? line.subtotal ?? line.unit_price ?? line.unitPrice ?? 0);
    if (!Number.isFinite(unitSubtotal) || !Number.isFinite(unitTotal)) {
      return { applied: false, quantity };
    }
    line.unit_price = Number(line.unit_price ?? line.unitPrice ?? unitSubtotal).toFixed(places);
    line.subtotal = (unitSubtotal * quantity).toFixed(places);
    line.total = (unitTotal * quantity).toFixed(places);
    line._pch_quantity_applied = true;
    return { applied: true, quantity };
  }

  private async catalogProducts(
    rows: Array<{ order: OrderEntity; storeOrder: StoreOrderEntity | null; items: OrderItemEntity[] }>,
  ): Promise<Map<string, unknown>> {
    const products = new Map<string, unknown>();
    if (!this.dataSource) return products;
    const idsByStore = new Map<string, Set<string>>();
    rows.forEach((row) => {
      const ids = idsByStore.get(row.order.storeId) ?? new Set<string>();
      const lines = Array.isArray(row.storeOrder?.lineItems) && row.storeOrder.lineItems.length
        ? row.storeOrder.lineItems
        : row.items;
      lines.forEach((line) => {
        const record = line as { product_id?: unknown; productId?: unknown };
        const productId = String(record?.product_id ?? record?.productId ?? '').trim();
        if (productId) ids.add(productId);
      });
      if (ids.size) idsByStore.set(row.order.storeId, ids);
    });
    for (const [storeId, ids] of idsByStore) {
      let found: Array<{ id?: string; product?: unknown }> = [];
      try {
        found = await this.dataSource.query(
          `SELECT product->>'id' AS id, product
           FROM public.store_products AS catalog
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(catalog.payload) = 'array' THEN catalog.payload
               WHEN jsonb_typeof(catalog.payload->'products') = 'array' THEN catalog.payload->'products'
               ELSE '[]'::jsonb
             END
           ) AS product
           WHERE catalog.store_id = $1::uuid
             AND COALESCE(catalog.is_deleted, false) = false
             AND product->>'id' = ANY($2::text[])`,
          [storeId, [...ids]],
        );
      } catch (error: unknown) {
        const code = error && typeof error === 'object'
          ? (error as { driverError?: { code?: string } }).driverError?.code
          : undefined;
        if (code === '42P01' || code === '42703' || code === '22P02') continue;
        throw error;
      }
      found.forEach((row) => {
        if (row.id && row.product) products.set(`${storeId}:${row.id}`, row.product);
      });
    }
    return products;
  }

  async findStoreCoupon(
    storeId: string,
    code: string,
    includeDeleted = false,
  ): Promise<Record<string, unknown> | null> {
    const normalized = String(code || '').trim();
    if (!this.dataSource || !normalized) return null;
    try {
      const activeCouponFilter = includeDeleted
        ? ''
        : `AND deleted_at IS NULL
           AND sync_status <> 'DELETED'`;
      const rows = await this.dataSource.query(
        `SELECT code, amount, discount_type, date_expires, individual_use,
                product_ids, excluded_product_ids, usage_limit, usage_count,
                usage_limit_per_user, minimum_amount, maximum_amount,
                email_restrictions, used_by, exclude_sale_items
         FROM public.store_coupons
         WHERE store_id = $1::uuid
           AND lower(code) = lower($2)
           ${activeCouponFilter}
         LIMIT 1`,
        [storeId, normalized],
      );
      return rows[0] ?? null;
    } catch (error: unknown) {
      const postgresCode = error instanceof QueryFailedError
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (postgresCode === '42P01' || postgresCode === '42703') return null;
      if (postgresCode === '22P02') throw new BadRequestException('storeId must be a UUID');
      throw error;
    }
  }

  async listStoreCoupons(storeId: string): Promise<Record<string, unknown>[]> {
    if (!this.dataSource || !storeId) return [];
    try {
      return await this.dataSource.query(
        `SELECT code, amount, discount_type, date_expires, individual_use,
                product_ids, excluded_product_ids, usage_limit, usage_count,
                usage_limit_per_user, minimum_amount, maximum_amount,
                email_restrictions, used_by, exclude_sale_items
         FROM public.store_coupons
         WHERE store_id = $1::uuid
           AND deleted_at IS NULL
           AND sync_status <> 'DELETED'
         ORDER BY lower(code)
         LIMIT 500`,
        [storeId],
      );
    } catch (error: unknown) {
      const postgresCode = error instanceof QueryFailedError
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (postgresCode === '42P01' || postgresCode === '42703') return [];
      if (postgresCode === '22P02') throw new BadRequestException('storeId must be a UUID');
      throw error;
    }
  }

  async getOrderDetails(id: string, storeId?: string) {
    const key = String(id || '').trim();
    if (!key) return null;
    if (!this.isDbConnected || !this.storeOrderRepo) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    const scopedStore = storeId?.trim() || undefined;
    if (this.isUuid(key)) {
      const byId = await this.getOrderById(key);
      if (byId && (!scopedStore || byId.order.storeId === scopedStore)) {
        return { order: byId.order, items: byId.items, storeOrder: byId.storeOrder };
      }
    }
    let matches: StoreOrderEntity[] = [];
    try {
      matches = await this.storeOrderRepo.find({
        where: scopedStore
          ? { clientOrderId: key, storeId: scopedStore }
          : { clientOrderId: key },
        order: { createdAt: 'DESC' },
        take: 1,
      });
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('storeId must be a UUID');
      }
      throw error;
    }
    const match = matches[0];
    if (!match) return null;
    await this.applyStoredOrderMeta([match]);
    return {
      order: this.projectOrder(match),
      items: this.itemsFromStore(match),
      storeOrder: match,
    };
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  async getOrdersByStore(storeId: string): Promise<OrderEntity[]> {
    if (this.isDbConnected && this.storeOrderRepo) {
      const rows = await this.storeOrderRepo.find({ where: { storeId }, order: { createdAt: 'DESC' } });
      await this.applyStoredOrderMeta(rows);
      return rows.map((row) => this.projectOrder(row));
    }
    return this.inMemoryOrders.filter(order => order.storeId === storeId);
  }

  async getStorePosPayments(storeId: string) {
    if (!this.isDbConnected || !this.dataSource) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }

    try {
      return await this.dataSource.query(
        `SELECT
         payment.id,
         payment.order_id,
         store_sale.order_number,
         payment.merchant_id,
         payment.store_id,
         payment.local_id,
         payment.client_order_id,
         payment.device_id,
         payment.shift_id,
         COALESCE(
           payment.user_id,
           store_sale.placed_by,
           payment.metadata->>'pos_placed_by',
           (
             SELECT item->>'value'
             FROM jsonb_array_elements(COALESCE(store_sale.meta_data, '[]'::jsonb)) AS item
             WHERE item->>'key' = 'pos_placed_by'
             LIMIT 1
           )
         ) AS user_id,
         payment.payment_type,
         payment.payment_method,
         COALESCE(payment.payment_method_title, store_sale.payment_method_title) AS payment_method_title,
         payment.amount,
         payment.order_total,
         payment.remaining,
         payment.remaining AS balance_amount,
         payment.refund_amount,
         payment.currency,
         payment.status,
         payment.entry_type,
         payment.provider,
         payment.provider_transaction_id,
         payment.payment_at
       FROM public.store_pos_payments AS payment
       LEFT JOIN public.store_orders AS store_sale ON store_sale.order_id = payment.order_id
       WHERE payment.store_id = $1::uuid
         AND payment.deleted_at IS NULL
       ORDER BY payment.payment_at DESC, payment.created_at DESC`,
        [storeId],
      );
    } catch (error) {
      console.error('[Order Service] Failed to list store POS payments', {
        storeId,
        error,
      });
      throw error;
    }
  }

  async getRefundAmountContext(clientOrderId: string, merchantId: string, storeId: string) {
    if (!this.isDbConnected || !this.dataSource) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    let rows: Array<{ id: string }>;
    try {
      rows = await this.dataSource.query(
        `SELECT sale.order_id AS id
           FROM public.store_orders AS sale
          WHERE sale.merchant_id = $1::uuid
            AND sale.store_id = $2::uuid
            AND (
              sale.client_order_id = $3
              OR sale.order_id::text = $3
              OR sale.id::text = $3
              OR sale.order_number = $3
            )
          ORDER BY sale.created_at DESC
          LIMIT 1`,
        [merchantId, storeId, clientOrderId],
      );
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
    if (!rows[0]) return null;
    const graph = await this.getOrderById(rows[0].id);
    if (!graph) return null;

    const payments = await this.dataSource.query(
      `SELECT id::text AS id, payment_method, amount, refund_amount, remaining,
              status, entry_type, is_void, metadata
         FROM public.store_pos_payments
        WHERE order_id = $1::uuid
          AND merchant_id = $2::uuid
          AND store_id = $3::uuid
          AND is_void = false
          AND deleted_at IS NULL
          AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled')
          AND COALESCE(metadata->>'daily_refund_tracking', 'false') <> 'true'
        ORDER BY payment_at ASC, created_at ASC`,
      [graph.order.id, merchantId, storeId],
    );
    let discountPayload: Record<string, unknown> = {};
    try {
      const discountRows = await this.dataSource.query(
        `SELECT payload FROM public.store_discounts
          WHERE store_id = $1::uuid AND COALESCE(is_deleted, false) = false
          LIMIT 1`,
        [storeId],
      );
      discountPayload = discountRows[0]?.payload || {};
    } catch (error: unknown) {
      const code = error instanceof QueryFailedError
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (code !== '42P01' && code !== '42703') throw error;
    }
    return { ...graph, payments, discountPayload };
  }

  private async loadRefundState(manager: EntityManager, orderId: string) {
    const payments = await manager.query(
      `SELECT id::text AS id, order_id, merchant_id, store_id, local_id, client_order_id,
              device_id, shift_id, user_id, payment_type, payment_method,
              payment_method_title, amount, order_total, remaining, refund_amount,
              currency, status, entry_type, provider, provider_transaction_id,
              payment_at, metadata
         FROM public.store_pos_payments
        WHERE order_id = $1::uuid AND entry_type = 'payment'
          AND is_void = false AND deleted_at IS NULL
          AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled')
        ORDER BY payment_at ASC, created_at ASC, id ASC
        FOR UPDATE`,
      [orderId],
    );
    const legacyRefunds = await manager.query(
      `SELECT amount, metadata
         FROM public.store_pos_payments
        WHERE order_id = $1::uuid AND entry_type = 'refund'
          AND is_void = false AND deleted_at IS NULL
          AND lower(COALESCE(status, 'completed')) NOT IN ('failed', 'cancelled', 'migrated')
          AND COALESCE(metadata->>'daily_refund_tracking', 'false') <> 'true'
        ORDER BY created_at ASC`,
      [orderId],
    );
    const refunded = payments.reduce(
      (sum: number, payment: any) => sum + Number(payment.refund_amount || 0),
      legacyRefunds.reduce((sum: number, refund: any) => sum + Number(refund.amount || 0), 0),
    );
    const allocatedEvents = [
      ...payments.flatMap((payment: any) => Array.isArray(payment.metadata?.refund_history)
        ? payment.metadata.refund_history : []),
      ...legacyRefunds.map((refund: any) => refund.metadata || {}),
    ];
    const events = [...new Map(allocatedEvents.map((event: any, index: number) => [
      String(event?.refund_id || event?.legacy_refund_id || `legacy-${index}`), event,
    ])).values()];
    return { payments, refunded, events };
  }

  private async applyRefundToPayments(
    manager: EntityManager,
    paymentRows: any[],
    refundAmount: number,
    event: Record<string, unknown>,
    timeZone = 'UTC',
  ): Promise<string> {
    const requestedCents = Math.round(refundAmount * 100);
    const eligible = paymentRows.map((payment) => ({
      payment,
      capacityCents: Math.max(0, Math.round(
        (Number(payment.amount || 0) - Number(payment.refund_amount || 0)) * 100,
      )),
    })).filter(({ capacityCents }) => capacityCents > 0);
    const totalCapacityCents = eligible.reduce((sum, row) => sum + row.capacityCents, 0);
    if (requestedCents > totalCapacityCents) {
      throw new BadRequestException('Refund exceeds the captured payment balance');
    }
    const allocations = eligible.map((row, index) => {
      const exact = totalCapacityCents > 0 ? requestedCents * row.capacityCents / totalCapacityCents : 0;
      return { ...row, index, allocationCents: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let centsLeft = requestedCents - allocations.reduce((sum, row) => sum + row.allocationCents, 0);
    for (const row of [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
      if (centsLeft <= 0) break;
      if (row.allocationCents < row.capacityCents) {
        row.allocationCents += 1;
        centsLeft -= 1;
      }
    }
    let paymentMethod = '';
    for (const { payment, allocationCents, capacityCents } of allocations) {
      if (allocationCents <= 0) continue;
      const allocation = allocationCents / 100;
      if (!paymentMethod) paymentMethod = String(payment.payment_method || 'Cash');
      const historyEvent = { ...event, amount: allocation, payment_id: payment.id };
      const dailyRefundStatus = allocationCents >= capacityCents
        ? 'refunded'
        : 'partially-refunded';
      await manager.query(
        `UPDATE public.store_pos_payments
            SET refund_amount = LEAST(amount, COALESCE(refund_amount, 0) + $2::numeric),
                remaining = GREATEST(0, amount - (COALESCE(refund_amount, 0) + $2::numeric)),
                status = CASE
                  WHEN COALESCE(refund_amount, 0) + $2::numeric >= amount THEN 'refunded'
                  ELSE 'partially-refunded'
                END,
                metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{refund_history}',
                  COALESCE(metadata->'refund_history', '[]'::jsonb) || $3::jsonb,
                  true
                ),
                updated_at = now()
          WHERE id = $1::uuid`,
        [payment.id, allocation, JSON.stringify([historyEvent])],
      );
      if (payment.order_id && payment.merchant_id && payment.store_id) {
        const refundDate = this.localDateKey(new Date(historyEvent.created_at || Date.now()), timeZone);
        const updatedDailyRows = await manager.query(
          `UPDATE public.store_pos_payments
              SET amount = amount + $2::numeric,
                  refund_amount = refund_amount + $2::numeric,
                  status = $6::varchar,
                  metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{refund_history}',
                    COALESCE(metadata->'refund_history', '[]'::jsonb) || $3::jsonb,
                    true
                  ),
                  updated_at = now()
            WHERE order_id = $4::uuid
              AND entry_type = 'refund'
              AND is_void = false
              AND deleted_at IS NULL
              AND metadata->>'daily_refund_tracking' = 'true'
              AND metadata->>'source_payment_id' = $1::text
              AND (
                metadata->>'refund_date' = $5::text
                OR (metadata->>'refund_date' IS NULL AND local_id LIKE '%:refund:' || $5::text)
              )
          RETURNING id`,
          [payment.id, allocation, JSON.stringify([historyEvent]), payment.order_id, refundDate, dailyRefundStatus],
        );
        // TypeORM's Postgres query runner can return DML results as
        // [returnedRows, affectedCount], whereas test and alternative drivers
        // return the rows array directly. Only returned rows indicate that a
        // daily refund record was actually updated.
        const returnedDailyRows = Array.isArray(updatedDailyRows?.[0])
          ? updatedDailyRows[0]
          : updatedDailyRows;
        const createDailyRefundRow = returnedDailyRows.length === 0
          && this.shouldCreateDailyRefundRow(payment, timeZone, new Date(historyEvent.created_at || Date.now()));
        if (!createDailyRefundRow) continue;
        await manager.query(
          `INSERT INTO public.store_pos_payments
             (order_id, merchant_id, store_id, local_id, client_order_id, device_id,
              shift_id, user_id, payment_type, payment_method, payment_method_title,
              amount, order_total, remaining, refund_amount, currency, status,
              entry_type, is_void, provider, provider_transaction_id, payment_at, metadata)
           VALUES ($1, $2, $3, LEFT(COALESCE($4, 'generated:' || $5::text), 120) || ':refund:' || $6,
                   $7, $8, $9, $10, $11, $12, $13, $15, $14, 0, $15, $16,
                   $20, 'refund', false, $17, $18, now(), $19::jsonb)`,
          [payment.order_id, payment.merchant_id, payment.store_id, payment.local_id,
            payment.id, refundDate, payment.client_order_id, payment.device_id,
            payment.shift_id, payment.user_id, payment.payment_type, payment.payment_method,
            payment.payment_method_title, payment.order_total, allocation, payment.currency,
            payment.provider, payment.provider_transaction_id, JSON.stringify({
              daily_refund_tracking: true,
              refund_date: refundDate,
              source_payment_id: payment.id,
              refund_history: [historyEvent],
            }), dailyRefundStatus],
        );
      }
    }
    return paymentMethod;
  }

  private remainingPaymentAmount(paymentRows: any[]): number {
    const cents = paymentRows.reduce((sum, payment) => sum + Math.max(0, Math.round(
      (Number(payment.amount || 0) - Number(payment.refund_amount || 0)) * 100,
    )), 0);
    return cents / 100;
  }

  private refundAuditBreakdown(
    appliedRefundTotal: number,
    itemRefundTotal: number,
    outstandingTax: number,
  ): { items_refund_total: number; tax_refund_total: number; adjustment_refund_total: number } {
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const additional = Math.max(0, round(appliedRefundTotal - itemRefundTotal));
    const taxRefund = Math.min(additional, Math.max(0, round(outstandingTax)));
    return {
      items_refund_total: round(itemRefundTotal),
      tax_refund_total: round(taxRefund),
      adjustment_refund_total: round(Math.max(0, additional - taxRefund)),
    };
  }

  private partialRefundLineAmount(refundableAmount: number): number {
    return Math.round(Math.max(0, refundableAmount) * 100) / 100;
  }

  private shouldCreateDailyRefundRow(payment: any, timeZone: string, refundAt = new Date()): boolean {
    const history = Array.isArray(payment?.metadata?.refund_history)
      ? payment.metadata.refund_history : [];
    const latest = history.map((entry: any) => new Date(entry?.created_at || 0))
      .filter((date: Date) => !Number.isNaN(date.getTime()))
      .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];
    return Boolean(latest && this.localDateKey(latest, timeZone) !== this.localDateKey(refundAt, timeZone));
  }

  private localDateKey(value: Date, timeZone: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(value);
      const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '00';
      return `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      return value.toISOString().slice(0, 10);
    }
  }

  private areAllLineItemsRefunded(
    lines: any[],
    previousItems: any[],
    currentItems: Array<Record<string, unknown>>,
  ): boolean {
    const refundableLines = lines.filter((line) => Number(line?.quantity || 0) > 0
      && !line?.is_refund_item
      && Number(line?.total ?? line?.total_price ?? 0) >= 0);
    if (!refundableLines.length) return false;
    const refundedItems = [...previousItems, ...currentItems];
    return refundableLines.every((line) => {
      const lineId = String(line?.id ?? '');
      if (!lineId) return false;
      const refundedQuantity = refundedItems
        .filter((item: any) => String(item?.order_item_id ?? '') === lineId)
        .reduce((sum: number, item: any) => sum + Number(item?.quantity ?? item?.qty ?? 0), 0);
      return refundedQuantity >= Number(line.quantity);
    });
  }

  async createFullOrderRefund(input: {
    clientOrderId: string;
    merchantId: string;
    storeId: string;
    requestedAmount: number;
    reason: string;
    restock: boolean;
    performedBy: string;
  }) {
    if (!this.isDbConnected || !this.dataSource) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    try {
      return await this.dataSource.transaction(async manager => {
        const rows = await manager.query(
          `SELECT sale.order_id AS id, sale.order_number, sale.total AS total_amount, sale.tax_total, sale.order_status,
                  sale.payment_method, sale.currency, sale.timezone, sale.line_items
             FROM public.store_orders AS sale
            WHERE sale.merchant_id = $1::uuid
              AND sale.store_id = $2::uuid
              AND (
                sale.client_order_id = $3
                OR sale.order_id::text = $3
                OR sale.id::text = $3
                OR sale.order_number = $3
              )
            ORDER BY sale.created_at DESC
            LIMIT 1
            FOR UPDATE OF sale`,
          [input.merchantId, input.storeId, input.clientOrderId],
        );
        const order = rows[0];
        if (!order) return { kind: 'missing' as const };

        const refundState = await this.loadRefundState(manager, order.id);
        const remainingOrderAmount = Math.max(0, Number(order.total_amount || 0) - refundState.refunded);
        const remaining = Math.min(this.remainingPaymentAmount(refundState.payments), remainingOrderAmount);
        if (remaining <= 0) return { kind: 'already_refunded' as const };
        if (input.requestedAmount - remaining > 0.005) {
          return { kind: 'exceeds_remaining' as const, remainingAmount: remaining };
        }
        // This is the full-refund endpoint: refund the entire outstanding
        // balance. The submitted amount is still validated by the service but
        // must never leave a residual balance while marking the order refunded.
        const refundedAmount = remaining;
        const lineItems = (Array.isArray(order.line_items) ? order.line_items : []).map((item: any, index: number) => ({
          id: item.id || `ITEM-${order.id}-${index + 1}`,
          product_id: item.product_id ?? item.productId,
          product_name: item.name || item.product_name,
          quantity: item.quantity,
        }));
        const refundId = randomUUID();
        const metadata = {
          reason: input.reason,
          restock: input.restock,
          performed_by: input.performedBy,
          line_items: lineItems.map((item: any) => ({
            order_item_id: item.id,
            product_id: item.product_id,
            quantity: Number(item.quantity || 0),
          })),
        };
        const paymentMethod = await this.applyRefundToPayments(manager, refundState.payments, refundedAmount, {
          refund_id: refundId,
          order_refund_amount: refundedAmount,
          refund_type: 'full',
          created_at: new Date().toISOString(),
          ...metadata,
          raw_payload: {
            order_id: input.clientOrderId,
            amount: input.requestedAmount,
            reason: input.reason,
            items_reusable: input.restock ? 'yes' : 'no',
          },
        }, String(order.timezone || 'UTC')) || String(order.payment_method || 'Cash');
        await manager.query(
          `UPDATE public.store_orders
              SET order_status = 'REFUNDED',
                  payment_status = 'REFUNDED',
                  status = 'refunded',
                  status_history = COALESCE(status_history, '[]'::jsonb) || $2::jsonb,
                  updated_at = now()
            WHERE order_id = $1::uuid`,
          [order.id, JSON.stringify([{
            id: `HST-${refundId}`,
            orderId: order.id,
            fromStatus: String(order.order_status || 'COMPLETED'),
            toStatus: 'REFUNDED',
            changedBy: input.performedBy,
            reason: input.reason,
            createdAt: new Date().toISOString(),
          }])],
        );
        await manager.query(
          `INSERT INTO public.order_status_history
             (id, order_id, from_status, to_status, changed_by, reason, created_at)
           VALUES ($1, $2::uuid, $3, 'REFUNDED', $4, $5, now())`,
          [`HST-${refundId}`, order.id, String(order.order_status || 'COMPLETED'), input.performedBy, input.reason],
        );

        if (input.restock && lineItems.length) {
          const columns = await manager.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'inventory_items'`,
          );
          const names = new Set(columns.map((column: any) => String(column.column_name)));
          const supportsPosInventory = ['storeId', 'productId', 'quantityOnHand', 'quantityAvailable', 'updatedAt']
            .every((name) => names.has(name));
          if (supportsPosInventory) {
            for (const [index, item] of lineItems.entries()) {
              const updated = await manager.query(
                `UPDATE public.inventory_items
                    SET "quantityOnHand" = "quantityOnHand" + $3,
                        "quantityAvailable" = "quantityAvailable" + $3,
                        "updatedAt" = now()
                  WHERE "storeId" = $1 AND "productId" = $2
                  RETURNING "quantityAvailable" AS quantity_available`,
                [input.storeId, String(item.product_id), Number(item.quantity || 0)],
              );
              const updatedRows = Array.isArray(updated[0]) ? updated[0] : updated;
              if (updatedRows[0]) {
                const available = Number(updatedRows[0].quantity_available || 0);
                await manager.query(
                  `INSERT INTO public.inventory_adjustments
                     (id, "storeId", "productId", "adjustmentType", "quantityChanged",
                      "newQuantityAvailable", "performedBy", reason, "createdAt")
                   VALUES ($1, $2, $3, 'REFUND_RESTOCK', $4, $5, $6, $7, now())`,
                  [`ADJ-REFUND-${refundId}-${index + 1}`, input.storeId, String(item.product_id),
                    Number(item.quantity || 0), available, input.performedBy,
                    `Full refund ${refundId}: ${input.reason}`],
                );
                await this.cacheInventoryStock(input.storeId, String(item.product_id), available);
              }
            }
          }
        }

        return {
          kind: 'created' as const,
          orderId: order.id,
          orderNumber: String(order.order_number || ''),
          paymentMethod,
          refundedAmount,
          refundId,
        };
      });
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
  }

  async createPartialOrderRefund(input: {
    clientOrderId: string;
    merchantId: string;
    storeId: string;
    reason: string;
    restock: boolean;
    performedBy: string;
    items: Array<{ orderItemId: string; quantity: number; refundableAmount: number }>;
  }) {
    if (!this.isDbConnected || !this.dataSource) {
      throw new ServiceUnavailableException('Order database is unavailable');
    }
    try {
      return await this.dataSource.transaction(async manager => {
        const rows = await manager.query(
          `SELECT sale.order_id AS id, sale.order_number, sale.total AS total_amount, sale.order_status,
                  sale.payment_method, sale.currency, sale.timezone, sale.line_items
             FROM public.store_orders AS sale
            WHERE sale.merchant_id = $1::uuid
              AND sale.store_id = $2::uuid
              AND (
                sale.client_order_id = $3
                OR sale.order_id::text = $3
                OR sale.id::text = $3
                OR sale.order_number = $3
              )
            ORDER BY sale.created_at DESC
            LIMIT 1
            FOR UPDATE OF sale`,
          [input.merchantId, input.storeId, input.clientOrderId],
        );
        const order = rows[0];
        if (!order) return { kind: 'missing' as const };
        const refundState = await this.loadRefundState(manager, order.id);
        const orderTotal = Number(order.total_amount || 0);
        const alreadyRefunded = refundState.refunded;
        const remainingOrderAmount = Math.max(0, orderTotal - alreadyRefunded);
        if (remainingOrderAmount <= 0) return { kind: 'already_refunded' as const };

        const storedLines = Array.isArray(order.line_items) ? order.line_items : [];
        const canonicalLines = await manager.query(
          `SELECT id, product_id, product_name AS name, quantity,
                  unit_price, total_price AS total, modifiers AS meta_data
             FROM public.order_line_items
            WHERE order_id = $1::uuid`,
          [order.id],
        );
        // Prefer the JSON snapshot for order totals because it contains the
        // original POS representation. Fall back to canonical rows for older
        // production orders whose snapshot is empty.
        const previousItems = refundState.events.flatMap((event: any) =>
          Array.isArray(event?.line_items) ? event.line_items : [],
        );
        const refundItems: Array<Record<string, unknown>> = [];
        let refundTotal = 0;
        for (const requested of input.items) {
          // Orders imported from POS can contain two representations of the same
          // lines: the store_orders JSON snapshot and canonical order_line_items.
          // Their IDs are not guaranteed to be identical. Completed-orders can
          // expose either one, so refund validation must accept both sources.
          const line = [...storedLines, ...canonicalLines]
            .find((candidate: any) => String(candidate?.id ?? '') === requested.orderItemId);
          if (!line) return { kind: 'invalid_item' as const };
          const maxQuantity = Number(line.quantity || 0);
          const refundedQuantity = previousItems
            .filter((item: any) => String(item?.order_item_id ?? '') === requested.orderItemId)
            .reduce((sum: number, item: any) => sum + Number(item.quantity ?? item.qty ?? 0), 0);
          const remainingQuantity = Math.max(0, maxQuantity - refundedQuantity);
          if (requested.quantity > remainingQuantity) {
            return { kind: 'qty_error' as const, remainingQuantity };
          }
          // Payout lines are separate cash movements that remain on the order.
          // They must not be prorated across selected merchandise refunds.
          const lineRefundAmount = this.partialRefundLineAmount(requested.refundableAmount);
          refundTotal += lineRefundAmount;
          refundItems.push({
            order_item_id: requested.orderItemId,
            product_id: line.variation_id || line.product_id || line.productId || null,
            name: line.name || line.product_name || '',
            quantity: requested.quantity,
            refundable_amount: requested.refundableAmount,
            refund_total: Math.round(lineRefundAmount * 100) / 100,
          });
        }
        refundTotal = Math.round(refundTotal * 100) / 100;
        if (refundTotal <= 0) return { kind: 'invalid_amount' as const };
        if (refundTotal > remainingOrderAmount) return { kind: 'exceeds_remaining' as const };

        const refundId = randomUUID();
        // Canonical line IDs are what completed-orders exposes and what refund
        // requests send back. Older POS JSON snapshots can omit IDs entirely,
        // so use canonical lines for the final-item completion check.
        const refundCompletionLines = canonicalLines.length ? canonicalLines : storedLines;
        const fullyRefunded = remainingOrderAmount - refundTotal <= 0.005
          || this.areAllLineItemsRefunded(refundCompletionLines, previousItems, refundItems);
        // The final item refund also closes out tax, tip, rounding, or other
        // captured residuals so a fully refunded payment cannot retain balance.
        const appliedRefundTotal = fullyRefunded
          ? this.remainingPaymentAmount(refundState.payments)
          : refundTotal;
        const previouslyRefundedTax = refundState.events.reduce(
          (sum: number, refund: any) => sum + Number(refund?.tax_refund_total || 0), 0,
        );
        const refundBreakdown = this.refundAuditBreakdown(
          appliedRefundTotal,
          refundTotal,
          Math.max(0, Number(order.tax_total || 0) - previouslyRefundedTax),
        );
        const remainingAfter = fullyRefunded ? 0 : Math.max(0, remainingOrderAmount - refundTotal);
        const refundOrderStatus = fullyRefunded ? 'REFUNDED' : 'PARTIAL_REFUND';
        const refundStoreStatus = fullyRefunded ? 'refunded' : 'partial-refund';
        const metadata = {
          reason: input.reason,
          restock: input.restock,
          performed_by: input.performedBy,
          refund_type: 'partial',
          line_items: refundItems,
          ...refundBreakdown,
        };
        await this.applyRefundToPayments(manager, refundState.payments, appliedRefundTotal, {
          refund_id: refundId,
          order_refund_amount: appliedRefundTotal,
          created_at: new Date().toISOString(),
          ...metadata,
          raw_payload: {
            order_id: input.clientOrderId,
            reason: input.reason,
            items_reusable: input.restock ? 'yes' : 'no',
            items: input.items,
          },
        }, String(order.timezone || 'UTC'));
        await manager.query(
          `UPDATE public.store_orders
              SET order_status = $4::varchar,
                  payment_status = CASE WHEN $4::varchar = 'REFUNDED' THEN 'REFUNDED' ELSE payment_status END,
                  status = $5::varchar,
                  status_history = COALESCE(status_history, '[]'::jsonb) || $3::jsonb,
                  meta_data = COALESCE(meta_data, '[]'::jsonb) || $2::jsonb,
                  updated_at = now()
            WHERE order_id = $1::uuid`,
          [order.id, JSON.stringify([
            { key: '_pos_partial_order_total', value: remainingAfter.toFixed(2) },
            { key: '_pos_refund_id', value: refundId },
          ]), JSON.stringify([{
            id: `HST-${refundId}`,
            orderId: order.id,
            fromStatus: String(order.order_status || 'COMPLETED'),
            toStatus: refundOrderStatus,
            changedBy: input.performedBy,
            reason: input.reason,
            createdAt: new Date().toISOString(),
          }]), refundOrderStatus, refundStoreStatus],
        );
        await manager.query(
          `INSERT INTO public.order_status_history
             (id, order_id, from_status, to_status, changed_by, reason, created_at)
           VALUES ($1, $2::uuid, $3, $4, $5, $6, now())`,
          [`HST-${refundId}`, order.id, String(order.order_status || 'COMPLETED'),
            refundOrderStatus, input.performedBy, input.reason],
        );

        if (input.restock && refundItems.length) {
          const columns = await manager.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'inventory_items'`,
          );
          const names = new Set(columns.map((column: any) => String(column.column_name)));
          const supported = ['storeId', 'productId', 'quantityOnHand', 'quantityAvailable', 'updatedAt']
            .every((name) => names.has(name));
          if (supported) {
            for (const [index, item] of refundItems.entries()) {
              if (!item.product_id) continue;
              const updated = await manager.query(
                `UPDATE public.inventory_items
                    SET "quantityOnHand" = "quantityOnHand" + $3,
                        "quantityAvailable" = "quantityAvailable" + $3,
                        "updatedAt" = now()
                  WHERE "storeId" = $1 AND "productId" = $2
                  RETURNING "quantityAvailable" AS quantity_available`,
                [input.storeId, String(item.product_id), Number(item.quantity || 0)],
              );
              const updatedRows = Array.isArray(updated[0]) ? updated[0] : updated;
              if (updatedRows[0]) {
                const available = Number(updatedRows[0].quantity_available || 0);
                await manager.query(
                  `INSERT INTO public.inventory_adjustments
                     (id, "storeId", "productId", "adjustmentType", "quantityChanged",
                      "newQuantityAvailable", "performedBy", reason, "createdAt")
                   VALUES ($1, $2, $3, 'REFUND_RESTOCK', $4, $5, $6, $7, now())`,
                  [`ADJ-REFUND-${refundId}-${index + 1}`, input.storeId, String(item.product_id),
                    Number(item.quantity || 0), available, input.performedBy,
                    `Partial refund ${refundId}: ${input.reason}`],
                );
                await this.cacheInventoryStock(input.storeId, String(item.product_id), available);
              }
            }
          }
        }
        return { kind: 'created' as const, orderId: order.id,
          orderNumber: String(order.order_number || ''), refundedAmount: appliedRefundTotal, refundId,
          orderStatus: refundStoreStatus };
      });
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '22P02') {
        throw new BadRequestException('x-merchant-id and x-store-id must be UUIDs');
      }
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<{ order: OrderEntity; items: OrderItemEntity[]; history: OrderStatusHistoryEntity[]; storeOrder: StoreOrderEntity | null } | null> {
    if (this.isDbConnected && this.storeOrderRepo) {
      const storeOrder = await this.storeOrderRepo.findOne({ where: { orderId } });
      if (!storeOrder) return null;
      await this.applyStoredOrderMeta([storeOrder]);
      const items = this.itemRepo ? await this.itemRepo.find({ where: { orderId } }) : [];
      const history = this.historyRepo
        ? await this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } })
        : [];
      return {
        order: this.projectOrder(storeOrder),
        items: items.length ? items : this.itemsFromStore(storeOrder),
        history: history.length ? history : this.historyFromStore(storeOrder),
        storeOrder,
      };
    }
    const order = this.inMemoryOrders.find(entry => entry.id === orderId);
    if (!order) return null;
    const items = this.inMemoryItems.filter(item => item.orderId === orderId);
    const history = this.inMemoryHistory.filter(entry => entry.orderId === orderId);
    return { order, items, history, storeOrder: null };
  }

  async getOrderByReference(reference: string): Promise<{ order: OrderEntity; items: OrderItemEntity[]; history: OrderStatusHistoryEntity[]; storeOrder: StoreOrderEntity | null } | null> {
    const key = String(reference || '').trim();
    if (!key) return null;
    if (this.isUuid(key)) return this.getOrderById(key);

    if (this.isDbConnected && this.storeOrderRepo) {
      const orderNumbers = key.startsWith('#') ? [key, key.slice(1)] : [key, `#${key}`];
      const storeOrder = await this.storeOrderRepo.findOne({
        where: [
          { clientOrderId: key },
          ...orderNumbers.map(orderNumber => ({ orderNumber })),
        ],
        order: { createdAt: 'DESC' },
      });
      return storeOrder ? this.getOrderById(storeOrder.orderId) : null;
    }

    const normalizedNumber = key.replace(/^#/, '');
    const order = this.inMemoryOrders.find(entry =>
      entry.clientOrderId === key || String(entry.orderNumber || '').replace(/^#/, '') === normalizedNumber,
    );
    return order ? this.getOrderById(order.id) : null;
  }

  private upsertOrderMeta(storeOrder: StoreOrderEntity, entries: Array<{ key: string; value: unknown }>): void {
    const current = Array.isArray(storeOrder.metadata)
      ? storeOrder.metadata.map((entry) => ({ ...entry }))
      : Array.isArray(storeOrder.metaData)
        ? (storeOrder.metaData as Array<{ key?: string; value?: unknown }>).map((entry) => ({
          key: String(entry?.key || ''),
          value: entry?.value,
        }))
        : [];
    entries.forEach((entry) => {
      const index = current.findIndex((item) => item?.key === entry.key);
      if (index >= 0) current[index] = { ...current[index], key: entry.key, value: entry.value };
      else current.push({ key: entry.key, value: entry.value });
    });
    storeOrder.metadata = current;
    storeOrder.metaData = current;
  }

  private async saveStoreOrderMeta(
    manager: EntityManager,
    orderId: string,
    metadata: unknown,
    metaData: unknown,
  ): Promise<void> {
    const entries = new Map<string, unknown>();
    const collect = (source: unknown) => {
      if (!Array.isArray(source)) return;
      source.forEach((entry) => {
        const key = String(entry?.key || '').trim().slice(0, 191);
        if (!key) return;
        entries.set(key, entry?.value ?? null);
      });
    };
    collect(metaData);
    collect(metadata);
    if (!entries.size) return;
    const rows = [...entries.entries()];
    await manager.query(
      `INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
       VALUES ${rows.map((_, index) => `($1, $${index * 2 + 2}, $${index * 2 + 3}::jsonb)`).join(', ')}
       ON CONFLICT (order_id, meta_key)
       DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = now()`,
      [orderId, ...rows.flatMap(([key, value]) => [key, JSON.stringify(value)])],
    );
  }

  private async applyStoredOrderMeta(storeOrders: StoreOrderEntity[]): Promise<void> {
    if (!this.dataSource || !storeOrders.length) return;
    const ids = [...new Set(storeOrders.map((order) => order.orderId).filter(Boolean))];
    if (!ids.length) return;
    let rows: Array<{ order_id: string; meta_key: string; meta_value: unknown }> = [];
    try {
      rows = await this.dataSource.query(
        `SELECT order_id::text AS order_id, meta_key, meta_value
           FROM public.store_orders_meta
          WHERE order_id = ANY($1::uuid[])`,
        [ids],
      );
    } catch (error: unknown) {
      const code = error && typeof error === 'object'
        ? (error as { driverError?: { code?: string } }).driverError?.code
        : undefined;
      if (code === '42P01') return;
      throw error;
    }
    const byOrder = new Map<string, Array<{ key: string; value: unknown }>>();
    rows.forEach((row) => {
      const list = byOrder.get(row.order_id) || [];
      list.push({ key: row.meta_key, value: row.meta_value });
      byOrder.set(row.order_id, list);
    });
    storeOrders.forEach((storeOrder) => {
      const stored = byOrder.get(storeOrder.orderId);
      if (stored?.length) this.upsertOrderMeta(storeOrder, stored);
    });
  }

  private projectOrder(store: StoreOrderEntity): OrderEntity {
    return {
      id: store.orderId,
      orderNumber: store.orderNumber || '',
      merchantId: store.merchantId,
      storeId: store.storeId,
      shiftId: store.shiftId,
      localShiftId: store.localShiftId,
      clientOrderId: store.clientOrderId,
      offline: Boolean(store.offline),
      metadata: store.metadata || (Array.isArray(store.metaData) ? store.metaData as OrderEntity['metadata'] : []),
      requestPayload: store.requestPayload,
      customerName: store.customerName || 'Walk-in Customer',
      customerPhone: store.customerPhone,
      orderType: (store.orderType as OrderType) || OrderType.IN_STORE_POS,
      paymentMethod: (store.paymentMethodCode as PaymentMethod) || PaymentMethod.CASH,
      paymentStatus: (store.paymentStatus as PaymentStatus) || PaymentStatus.PAID,
      subtotal: Number(store.subtotal || 0),
      taxAmount: Number(store.taxTotal || 0),
      discountAmount: Number(store.discountTotal || 0),
      tipAmount: Number(store.tipAmount || 0),
      totalAmount: Number(store.total || 0),
      orderStatus: (store.orderStatus as OrderStatus) || OrderStatus.CREATED,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
    };
  }

  private itemsFromStore(store: StoreOrderEntity): OrderItemEntity[] {
    const lines = Array.isArray(store.lineItems) ? store.lineItems : [];
    return lines.map((raw, index) => {
      const line = raw as Record<string, unknown>;
      const quantity = Number(line.quantity || 1);
      const total = Number(line.total ?? line.total_price ?? 0);
      return {
        id: String(line.id || `ITEM-${store.orderId}-${index + 1}`),
        orderId: store.orderId,
        productId: String(line.product_id ?? line.productId ?? ''),
        productName: String(line.name || line.product_name || 'Sales Item'),
        quantity,
        unitPrice: Number(line.price ?? line.unit_price ?? (quantity ? total / quantity : 0)),
        totalPrice: total,
        modifiers: Array.isArray(line.meta_data) ? line.meta_data : undefined,
      };
    });
  }

  private historyFromStore(store: StoreOrderEntity): OrderStatusHistoryEntity[] {
    const rows = Array.isArray(store.statusHistory) ? store.statusHistory : [];
    return rows.map((raw) => raw as OrderStatusHistoryEntity);
  }

  private async consolidateDuplicateTables(): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(`
      ALTER TABLE public.store_orders
        ADD COLUMN IF NOT EXISTS order_number varchar(100) DEFAULT '',
        ADD COLUMN IF NOT EXISTS customer_name varchar(150) DEFAULT 'Walk-in Customer',
        ADD COLUMN IF NOT EXISTS customer_phone varchar(50),
        ADD COLUMN IF NOT EXISTS order_type varchar(50) DEFAULT 'IN_STORE_POS',
        ADD COLUMN IF NOT EXISTS payment_method_code varchar(50),
        ADD COLUMN IF NOT EXISTS payment_status varchar(50) DEFAULT 'PAID',
        ADD COLUMN IF NOT EXISTS tip_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS offline boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS local_shift_id varchar(100),
        ADD COLUMN IF NOT EXISTS metadata jsonb,
        ADD COLUMN IF NOT EXISTS request_payload jsonb,
        ADD COLUMN IF NOT EXISTS order_status varchar(50) DEFAULT 'CREATED',
        ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    const orders = await this.dataSource.query(`SELECT to_regclass('public.orders') AS name`);
    if (orders[0]?.name) {
      await this.dataSource.query(`
        UPDATE public.store_orders AS sale
           SET order_number = legacy.order_number,
               customer_name = COALESCE(legacy.customer_name, sale.customer_name),
               customer_phone = legacy.customer_phone,
               order_type = COALESCE(legacy.order_type, sale.order_type),
               payment_method_code = legacy.payment_method,
               payment_status = COALESCE(legacy.payment_status, sale.payment_status),
               tip_amount = COALESCE(legacy.tip_amount, 0),
               offline = COALESCE(legacy.offline, false),
               local_shift_id = legacy.local_shift_id,
               metadata = legacy.metadata,
               request_payload = legacy.request_payload,
               order_status = COALESCE(legacy.order_status, sale.order_status)
          FROM public.orders AS legacy
         WHERE sale.order_id = legacy.id
      `);
    }
    const history = await this.dataSource.query(`SELECT to_regclass('public.order_status_history') AS name`);
    if (history[0]?.name) {
      await this.dataSource.query(`
        UPDATE public.store_orders AS sale
           SET status_history = COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', entry.id,
               'orderId', entry.order_id,
               'fromStatus', entry.from_status,
               'toStatus', entry.to_status,
               'changedBy', entry.changed_by,
               'reason', entry.reason,
               'createdAt', entry.created_at
             ) ORDER BY entry.created_at)
             FROM public.order_status_history AS entry
             WHERE entry.order_id = sale.order_id
           ), sale.status_history, '[]'::jsonb)
         WHERE EXISTS (
           SELECT 1 FROM public.order_status_history AS entry WHERE entry.order_id = sale.order_id
         )
      `);
    }
    const categories = await this.dataSource.query(`SELECT to_regclass('public.categories') AS name`);
    const storeCategories = await this.dataSource.query(`SELECT to_regclass('public.store_categories') AS name`);
    if (categories[0]?.name && storeCategories[0]?.name) {
      await this.dataSource.query(`
        UPDATE public.store_categories AS catalog
           SET payload = COALESCE(catalog.payload, '[]'::jsonb) || COALESCE((
             SELECT jsonb_agg(to_jsonb(category))
               FROM public.categories AS category
              WHERE COALESCE(to_jsonb(category)->>'storeId', to_jsonb(category)->>'store_id') = catalog.store_id::text
                AND NOT EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(COALESCE(catalog.payload, '[]'::jsonb)) AS saved
                   WHERE saved->>'id' = COALESCE(to_jsonb(category)->>'wordpressId', to_jsonb(category)->>'wordpress_id')
                      OR saved->>'wordpressId' = COALESCE(to_jsonb(category)->>'wordpressId', to_jsonb(category)->>'wordpress_id')
                )
           ), '[]'::jsonb)
      `);
    }
    await this.dataSource.query(`
      ALTER TABLE public.store_pos_payments DROP CONSTRAINT IF EXISTS store_pos_payments_order_id_fkey
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS store_orders_order_id_uidx
      ON public.store_orders (order_id)
    `);
    const payments = await this.dataSource.query(`SELECT to_regclass('public.store_pos_payments') AS name`);
    if (payments[0]?.name) {
      await this.dataSource.query(`
        ALTER TABLE public.store_pos_payments
          ADD CONSTRAINT store_pos_payments_order_id_fkey
          FOREIGN KEY (order_id) REFERENCES public.store_orders(order_id) ON DELETE CASCADE
      `);
    }
    await this.dataSource.query(`DROP TABLE IF EXISTS public.orders`);
    await this.ensureOrderDetailTables();
    await this.dataSource.query(`DROP TABLE IF EXISTS public.products`);
    await this.dataSource.query(`DROP TABLE IF EXISTS public.product`);
    await this.dataSource.query(`DROP TABLE IF EXISTS public.categories`);
  }

  private async saveLineItems(manager: EntityManager, orderId: string, items: OrderItemEntity[], replace: boolean): Promise<void> {
    const repository = manager.getRepository(OrderItemEntity);
    if (replace) await repository.delete({ orderId });
    if (!items.length) return;
    await repository.save(items.map((item) => repository.create({ ...item, orderId })));
  }

  private async saveStatusHistory(manager: EntityManager, entry: OrderStatusHistoryEntity): Promise<void> {
    if (!entry?.id) return;
    const repository = manager.getRepository(OrderStatusHistoryEntity);
    await repository.save(repository.create({
      ...entry,
      createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
    }));
  }

  private async ensureOrderDetailTables(): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.order_line_items (
        id varchar(100) PRIMARY KEY,
        order_id uuid NOT NULL,
        product_id varchar(100) NOT NULL,
        product_name varchar(255) NOT NULL,
        quantity numeric(10,2) NOT NULL,
        unit_price numeric(10,2) NOT NULL,
        total_price numeric(10,2) NOT NULL,
        modifiers jsonb
      )
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.order_status_history (
        id varchar(100) PRIMARY KEY,
        order_id uuid NOT NULL,
        from_status varchar(50) NOT NULL,
        to_status varchar(50) NOT NULL,
        changed_by varchar(150) NOT NULL,
        reason varchar(255),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS order_line_items_order_id_idx ON public.order_line_items (order_id)
    `);
    // Legacy installations created these tables without primary keys. The
    // backfills and runtime inserts use ON CONFLICT (id), which requires a
    // matching unique constraint or index.
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS order_line_items_id_uidx ON public.order_line_items (id)
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS order_status_history_id_uidx ON public.order_status_history (id)
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS order_status_history_order_id_idx ON public.order_status_history (order_id)
    `);
    await this.dataSource.query(`
      INSERT INTO public.order_line_items
        (id, order_id, product_id, product_name, quantity, unit_price, total_price, modifiers)
      SELECT LEFT(COALESCE(NULLIF(line->>'id', ''), 'ITEM-' || sale.order_id::text || '-' || ordinality::text), 100),
             sale.order_id,
             LEFT(COALESCE(line->>'product_id', line->>'productId', ''), 100),
             LEFT(COALESCE(NULLIF(line->>'name', ''), NULLIF(line->>'product_name', ''), 'Sales Item'), 255),
             CASE WHEN COALESCE(line->>'quantity', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN (line->>'quantity')::numeric ELSE 1 END,
             CASE WHEN COALESCE(line->>'price', line->>'unit_price', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN COALESCE(line->>'price', line->>'unit_price')::numeric
                  WHEN COALESCE(line->>'quantity', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                   AND (line->>'quantity')::numeric <> 0
                   AND COALESCE(line->>'total', line->>'total_price', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN COALESCE(line->>'total', line->>'total_price')::numeric / (line->>'quantity')::numeric
                  ELSE 0 END,
             CASE WHEN COALESCE(line->>'total', line->>'total_price', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN COALESCE(line->>'total', line->>'total_price')::numeric ELSE 0 END,
             CASE WHEN jsonb_typeof(line->'meta_data') = 'array' THEN line->'meta_data' ELSE NULL END
        FROM public.store_orders AS sale
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale.line_items, '[]'::jsonb))
          WITH ORDINALITY AS lines(line, ordinality)
      ON CONFLICT (id) DO NOTHING
    `);
    await this.dataSource.query(`
      INSERT INTO public.order_status_history
        (id, order_id, from_status, to_status, changed_by, reason, created_at)
      SELECT LEFT(COALESCE(NULLIF(entry->>'id', ''), 'HST-' || sale.order_id::text || '-' || ordinality::text), 100),
             sale.order_id,
             LEFT(COALESCE(NULLIF(entry->>'fromStatus', ''), NULLIF(entry->>'from_status', ''), 'NONE'), 50),
             LEFT(COALESCE(NULLIF(entry->>'toStatus', ''), NULLIF(entry->>'to_status', ''), NULLIF(sale.order_status, ''), 'CREATED'), 50),
             LEFT(COALESCE(NULLIF(entry->>'changedBy', ''), NULLIF(entry->>'changed_by', ''), 'POS System'), 150),
             LEFT(COALESCE(entry->>'reason', ''), 255),
             COALESCE(
               CASE WHEN COALESCE(entry->>'createdAt', entry->>'created_at', '') ~ '^[0-9]{4}-'
                    THEN COALESCE(entry->>'createdAt', entry->>'created_at')::timestamptz END,
               sale.created_at,
               now()
             )
        FROM public.store_orders AS sale
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale.status_history, '[]'::jsonb))
          WITH ORDINALITY AS entries(entry, ordinality)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  private async cacheOrder(order: OrderEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`order:${order.id}`, JSON.stringify(order), 'EX', 86400);
      } catch {}
    }
  }

  private async cacheInventoryStock(storeId: string, productId: string, quantityAvailable: number) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`stock:${storeId}:${productId}`, String(quantityAvailable), 'EX', 86400);
      } catch {}
    }
  }
}
