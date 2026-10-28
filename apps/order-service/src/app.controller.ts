import { Controller, Get, Post, Put, Patch, Body, Param, Query, Headers, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { OrderStatus, OrderType, PaymentMethod, PaymentStatus } from './entities/order.entity';
import type { StoreOrderCalculationInput } from './calculations/store-order.calculations';
import { OrderUpdatePresenter } from './modules/order-updates/order-update.presenter';
import { OrderListPresenter } from './responses/order-list.presenter';
import { OrderResponsePresenter } from './responses/order-response.presenter';
import { OrderWebsiteSyncService } from './website-sync/order-website-sync.service';

@Controller(['api/v1/orders', 'connector/api/v1/orders'])
export class AppController {
  constructor(
    @Inject(OrderRepository)
    private readonly orderRepository: OrderRepository,
    @Inject(OrderResponsePresenter)
    private readonly responses: OrderResponsePresenter,
    @Inject(OrderListPresenter)
    private readonly orderLists: OrderListPresenter,
    @Inject(OrderUpdatePresenter)
    private readonly orderDetails: OrderUpdatePresenter,
    @Inject(OrderWebsiteSyncService)
    private readonly websiteSync: OrderWebsiteSyncService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'order-service',
      version: '2.0.0 (PCH Module 7)',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('calculations')
  calculate(
    @Body() body: any,
    @Headers('x-store-id') storeHeader?: string,
  ) {
    const input: StoreOrderCalculationInput = {
      lineItems: body?.lineItems ?? body?.line_items ?? [],
      feeLines: body?.feeLines ?? body?.fee_lines ?? [],
      taxLines: body?.taxLines ?? body?.tax_lines ?? [],
      payments: Array.isArray(body?.payments) ? body.payments : [],
      discountAmount: body?.discountAmount,
      tax: body?.tax,
      includeFees: Boolean(body?.includeFees),
      includePayments: Boolean(body?.includePayments),
      includeCashbackFee: Boolean(body?.includeCashbackFee),
      cashbackAmount: body?.cashbackAmount,
      shippingTotal: body?.shippingTotal ?? body?.shipping_total,
      decimalPlaces: body?.decimalPlaces,
    };
    return this.orderRepository.calculate(input, storeHeader || body?.storeId || body?.store_id);
  }

  // --- 1. Create New Order (POS / Web / Online Delivery) ---
  @Post()
  async createOrder(
    @Body() body: any,
    @Headers('x-store-id') storeHeader?: string,
    @Headers('x-merchant-id') merchantHeader?: string,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    const normalized = this.normalizeCreateOrder(body, storeHeader, merchantHeader, deviceHeader);
    if (!normalized.storeId || !normalized.items.length) {
      throw new BadRequestException('storeId and at least 1 item are required to create an order');
    }
    if (normalized.shiftId) {
      console.log(`[shift-debug] request ${JSON.stringify({
        action: 'POST /orders',
        shift_id: normalized.shiftId,
        local_shift_id: normalized.localShiftId || null,
        payment_method: normalized.paymentMethod,
        total: normalized.totalAmount ?? null,
        saved_to: ['store_orders', 'store_pos_payments'],
        not_saved_to: ['pos_shifts', 'pos_shift_meta', 'pos_shift_transactions'],
      })}`);
    }
    let result: Awaited<ReturnType<OrderRepository['createOrder']>>;
    try {
      result = await this.orderRepository.createOrder(normalized);
    } catch (error) {
      if (normalized.shiftId) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[shift-debug] error ${JSON.stringify({ action: 'POST /orders', shift_id: normalized.shiftId, message })}`);
      }
      throw error;
    }
    if (normalized.shiftId) {
      console.log(`[shift-debug] response ${JSON.stringify({
        action: 'POST /orders',
        shift_id: normalized.shiftId,
        order_id: result.order?.id ?? null,
      })}`);
    }
    const request = result.order.requestPayload || body;
    if (result.duplicate) {
      console.log(`[ORDER_WEBSITE_SYNC] ${JSON.stringify({
        event: 'skipped',
        orderId: result.order.id,
        clientOrderId: result.order.clientOrderId || null,
        reason: 'local order already existed',
      })}`);
    } else {
      console.log(`[ORDER_WEBSITE_SYNC] ${JSON.stringify({
        event: 'called',
        orderId: result.order.id,
        clientOrderId: result.order.clientOrderId || null,
        storeId: result.order.storeId,
      })}`);
      await this.websiteSync.syncCreatedOrder({
        orderId: result.order.id,
        storeId: result.order.storeId,
        clientOrderId: result.order.clientOrderId,
        customerName: result.order.customerName,
        customerPhone: result.order.customerPhone,
        request,
      });
    }
    return this.responses.present(this.responses.profileFor(request), { result, request });
  }

  // --- 2. Get All Orders for Store ---
  @Get()
  async getOrders(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const orders = await this.orderRepository.getOrdersByStore(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: orders.length,
      orders,
    };
  }

  @Get('total-orders-count')
  getAdminOrderCounts(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('store_id') storeId?: string,
    @Headers('x-store-id') storeHeader?: string,
  ) {
    if (storeId && storeHeader && storeId.trim() !== storeHeader.trim()) throw new BadRequestException('Conflicting store IDs');
    return this.orderRepository.getAdminOrderCounts(storeHeader || storeId, startDate, endDate);
  }

  @Get('total-orders')
  async listTotalOrders(
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('status') status?: string,
    @Query('created_via') createdVia?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
    @Headers('x-store-id') storeHeader?: string,
  ) {
    const criteria = this.orderLists.criteria({
      page,
      perPage,
      status,
      createdVia,
      storeId: storeHeader || storeId || storeIdSnake,
    });
    const listed = await this.orderRepository.listOrders(criteria);
    await this.hydrateCouponLines(listed.orders);
    return this.orderLists.present(criteria.page, criteria.perPage, listed.total, listed.orders);
  }

  @Get('website-sync')
  async readWebsiteSync(
    @Headers('x-store-id') storeHeader?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
  ) {
    const id = this.storeId(storeHeader || storeId || storeIdSnake);
    return { storeId: id, enabled: await this.websiteSync.readEnabled(id) };
  }

  @Put('website-sync')
  async updateWebsiteSync(
    @Body() body: { enabled?: boolean },
    @Headers('x-store-id') storeHeader?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
  ) {
    if (typeof body?.enabled !== 'boolean') throw new BadRequestException('enabled must be true or false');
    return this.websiteSync.updateEnabled(this.storeId(storeHeader || storeId || storeIdSnake), body.enabled);
  }

  private storeId(value?: string): string {
    const storeId = String(value || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
      throw new BadRequestException('x-store-id must be a store UUID');
    }
    return storeId;
  }

  @Get('status-counts')
  async getOrderStatusCounts(
    @Query('status') status?: string,
    @Query('created_via') createdVia?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
    @Headers('x-store-id') storeHeader?: string,
  ) {
    const criteria = this.orderLists.criteria({ status, createdVia, storeId: storeHeader || storeId || storeIdSnake });
    const result = await this.orderRepository.getOrderStatusCounts(criteria);
    return { success: true, order_total_count: result.total, status_counts: result.statusCounts };
  }

  // Screen-ready order list and summary cards for the Orders dashboard.
  @Get('all-merchant-orders')
  async getOrdersDashboard(
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('status') status?: string,
    @Query('created_via') createdVia?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
    @Headers('x-store-id') storeHeader?: string,
    @Headers('x-merchant-id') merchantHeader?: string,
  ) {
    const criteria = this.orderLists.criteria({
      page,
      perPage,
      status,
      createdVia,
      storeId: storeHeader || storeId || storeIdSnake,
    });
    const listed = await this.orderRepository.listOrders({ ...criteria, merchantId: merchantHeader || undefined });
    await this.hydrateCouponLines(listed.orders);
    const orders = listed.orders.map(({ order, storeOrder, effectiveStatus }) => {
      const request = (order.requestPayload || {}) as Record<string, any>;
      const metadata = Array.isArray(order.metadata) ? order.metadata : [];
      const metaValue = (key: string) => metadata.find((entry) => entry?.key === key)?.value;
      const requestMetadata = Array.isArray(request.meta_data) ? request.meta_data : [];
      const requestClientOrderId = requestMetadata.find((entry) => entry?.key === '_pos_client_order_id')?.value;
      const storedCouponLines = Array.isArray(storeOrder?.couponLines) ? storeOrder.couponLines : [];
      const couponLines = storedCouponLines.length
        ? storedCouponLines
        : (Array.isArray(request.coupon_lines) ? request.coupon_lines : []);
      const clientOrderId = storeOrder?.clientOrderId
        || order.clientOrderId
        || metaValue('_pos_client_order_id')
        || requestClientOrderId
        || null;
      const orderNumber = storeOrder?.orderNumber || order.orderNumber || '';
      const status = effectiveStatus.toLowerCase() === 'processing'
        && String(order.orderStatus).toUpperCase() === 'CREATED'
        ? 'created'
        : effectiveStatus;
      return {
        id: order.id,
        order_id: String(orderNumber),
        order_number: String(orderNumber),
        woo_order_id: String(orderNumber),
        client_order_id: clientOrderId === null ? null : String(clientOrderId),
        date: order.createdAt,
        status,
        customer: storeOrder?.customerName || order.customerName || request.billing?.first_name || 'Walk-in Customer',
        total: Number(storeOrder?.total ?? order.totalAmount ?? 0),
        currency: storeOrder?.currency || request.currency || 'USD',
        payment_status: order.paymentStatus,
        payment_method: order.paymentMethod,
        coupon_lines: couponLines,
        store_id: order.storeId,
        merchant_id: order.merchantId,
      };
    });
    const completed = orders.filter((order) => order.status.toLowerCase() === 'completed').length;
    const pendingPayment = orders.filter((order) => String(order.paymentStatus).toLowerCase() === 'pending').length;
    const totalValue = orders.reduce((sum, order) => sum + order.total, 0);
    return {
      success: true,
      cards: {
        total_orders: listed.total,
        completed,
        completed_percent: listed.total ? Number(((completed / listed.total) * 100).toFixed(1)) : 0,
        pending_payment: pendingPayment,
        pending_payment_percent: listed.total ? Number(((pendingPayment / listed.total) * 100).toFixed(1)) : 0,
        total_value: Number(totalValue.toFixed(2)),
        total_value_scope: 'loaded_orders',
      },
      pagination: { page: criteria.page, per_page: criteria.perPage, total: listed.total },
      orders,
    };
  }

  // --- 3. Get Single Order Detail with Items & State History ---
  @Get(':id')
  async getOrderById(
    @Param('id') id: string,
    @Headers('x-store-id') storeHeader?: string,
    @Query('storeId') storeId?: string,
    @Query('store_id') storeIdSnake?: string,
  ) {
    if (['completed-orders', 'full-order-refund', 'partial-order-refund', 'get-amt-by-paymethod', 'refund-valid-user', 'health', 'calculations'].includes(id)) {
      throw new NotFoundException(`Endpoint '${id}' not found`);
    }
    const data = await this.orderRepository.getOrderDetails(id, storeHeader || storeId || storeIdSnake);
    if (!data) throw new NotFoundException(`Order '${id}' not found`);
    return this.orderDetails.present(data);
  }

  // --- 4. Update Order Status (State Machine Transition) ---
  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: OrderStatus; changedBy?: string; reason?: string }) {
    if (!body.status) {
      throw new BadRequestException('target status is required');
    }
    const updated = await this.orderRepository.updateOrderStatus(id, body.status, body.changedBy || 'Cashier', body.reason);
    if (!updated) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    return {
      success: true,
      message: `Order #${id} status updated to '${updated.orderStatus}'`,
      order: updated,
    };
  }

  private normalizeCreateOrder(body: any, storeHeader?: string, merchantHeader?: string, deviceHeader?: string) {
    const metadata = Array.isArray(body?.meta_data) ? body.meta_data : [];
    const metaValue = (key: string) => metadata.find((entry: any) => entry?.key === key)?.value;
    const sourceItems = Array.isArray(body?.line_items) ? body.line_items : body?.items;
    const items = Array.isArray(sourceItems) ? sourceItems.map((item: any) => {
      const quantity = Number(item.quantity || 1);
      const lineTotal = Number(item.total ?? item.subtotal ?? item.totalPrice ?? 0);
      return {
        productId: String(item.product_id ?? item.productId ?? ''),
        productName: item.name || item.productName || 'Sales Item',
        quantity,
        unitPrice: item.unitPrice !== undefined ? Number(item.unitPrice) : lineTotal / quantity,
        totalPrice: lineTotal,
        modifiers: Array.isArray(item.meta_data) ? item.meta_data : item.modifiers || [],
      };
    }) : [];
    const lineSubtotal = items.reduce(
      (sum: number, item: any) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    );
    const isPayoutLine = (item: any) => {
      const itemMetadata = Array.isArray(item?.meta_data) ? item.meta_data : [];
      const itemType = itemMetadata.find((entry: any) => entry?.key === '_pos_item_type')?.value;
      return String(itemType || item?.name || '').trim().toLowerCase() === 'payout';
    };
    const hasPayout = Array.isArray(sourceItems) && sourceItems.some(isPayoutLine);
    const payoutOnly = hasPayout && sourceItems.every(isPayoutLine);
    const hasEbtItem = Array.isArray(sourceItems) && sourceItems.some((item: any) => {
      const itemMetadata = Array.isArray(item?.meta_data) ? item.meta_data : [];
      const value = itemMetadata.find((entry: any) => entry?.key === '_is_ebt_eligible')?.value;
      return value === 1 || value === '1' || value === true;
    });
    const completedFinancialMovement = payoutOnly || (hasPayout && hasEbtItem);
    const declaredPayments = metaValue('_pos_payments');
    const paymentsCompleted = Array.isArray(declaredPayments) && declaredPayments.length > 0
      && declaredPayments.every((payment: any) => String(payment?.status || '').trim().toLowerCase() === 'completed');
    const normalizedStatus = completedFinancialMovement && paymentsCompleted ? 'completed' : body?.status;
    const status = String(normalizedStatus || '').toUpperCase();
    const requestPayload = completedFinancialMovement && paymentsCompleted
      ? { ...body, status: normalizedStatus }
      : body;
    const method = String(body?.payment_method || body?.paymentMethod || 'CASH').toUpperCase();
    return {
      ...body,
      status: normalizedStatus,
      storeId: storeHeader || body?.storeId || body?.store_id,
      merchantId: merchantHeader || body?.merchantId || body?.merchant_id,
      deviceId: String(
        deviceHeader ?? body?.device_id ?? body?.deviceId
        ?? metaValue('pos_device_id') ?? metaValue('_pos_device_id') ?? metaValue('device_id') ?? '',
      ).trim() || undefined,
      shiftId: String(body?.shift_id ?? body?.shiftId ?? metaValue('shift_id') ?? '').trim() || undefined,
      localShiftId: String(body?.local_shift_id ?? body?.localShiftId ?? metaValue('local_shift_id') ?? ''),
      clientOrderId: String(metaValue('_pos_client_order_id') ?? body?.clientOrderId ?? ''),
      offline: Boolean(body?.offline ?? metaValue('offline') ?? metaValue('is_offline')),
      metadata,
      requestPayload,
      source: Array.isArray(body?.line_items) ? 'WORDPRESS_COMPATIBLE' : 'PCH',
      items,
      subtotal: body?.subtotal !== undefined ? Number(body.subtotal) : lineSubtotal,
      taxAmount: Number(body?.taxAmount ?? metaValue('_pos_order_tax') ?? 0),
      discountAmount: Number(body?.discountAmount ?? 0),
      tipAmount: Number(body?.tipAmount ?? 0),
      totalAmount: body?.total !== undefined ? Number(body.total) : undefined,
      customerName: body?.customerName || 'Walk-in Customer',
      customerPhone: body?.customerPhone || '',
      orderType: body?.orderType || OrderType.IN_STORE_POS,
      paymentMethod: method.includes('CARD') ? PaymentMethod.CARD
        : method.includes('UPI') ? PaymentMethod.UPI
          : method.includes('CREDIT') ? PaymentMethod.STORE_CREDIT
            : PaymentMethod.CASH,
      paymentStatus: body?.set_paid === false ? PaymentStatus.PENDING : PaymentStatus.PAID,
      orderStatus: Object.values(OrderStatus).includes(status as OrderStatus)
        ? status as OrderStatus
        : OrderStatus.CREATED,
    };
  }

  private async hydrateCouponLines(rows: Array<{
    order: { storeId: string; requestPayload?: unknown; discountAmount?: unknown };
    storeOrder: { couponLines?: unknown[]; discountTotal?: unknown } | null;
  }>): Promise<void> {
    const couponCatalog = new Map<string, Promise<Record<string, unknown> | null>>();
    await Promise.all(rows.map(async ({ order, storeOrder }) => {
      const request = (order.requestPayload || {}) as Record<string, any>;
      const stored = Array.isArray(storeOrder?.couponLines) ? storeOrder.couponLines : [];
      const requested = Array.isArray(request.coupon_lines) ? request.coupon_lines : [];
      const source = stored.length ? stored : requested;
      if (!source.length) return;

      const hydrated = await Promise.all(source.map(async (entry) => {
        const coupon = entry && typeof entry === 'object'
          ? entry as Record<string, any>
          : { code: entry };
        const code = String(coupon.code || '').trim();
        if (!code) return coupon;
        const catalogKey = `${order.storeId}:${code.toLowerCase()}`;
        if (!couponCatalog.has(catalogKey)) {
          couponCatalog.set(catalogKey, this.orderRepository.findStoreCoupon(order.storeId, code, true));
        }
        const catalog = await couponCatalog.get(catalogKey)!;
        if (!catalog) return coupon;

        const metadata = Array.isArray(coupon.meta_data) ? [...coupon.meta_data] : [];
        const setMetadata = (key: string, value: unknown) => {
          if (!metadata.some((item) => item?.key === key)) metadata.push({ key, value });
        };
        const configuredAmount = Number(catalog.amount);
        setMetadata('discount_type', catalog.discount_type || 'fixed_cart');
        setMetadata(
          'amount',
          Number.isFinite(configuredAmount) ? String(configuredAmount) : String(catalog.amount ?? '0'),
        );
        setMetadata('product_ids', Array.isArray(catalog.product_ids) ? catalog.product_ids : []);
        setMetadata(
          'excluded_product_ids',
          Array.isArray(catalog.excluded_product_ids) ? catalog.excluded_product_ids : [],
        );
        const fallbackDiscount = source.length === 1
          ? Number(storeOrder?.discountTotal ?? order.discountAmount ?? 0)
          : 0;
        const discount = Number.isFinite(configuredAmount)
          ? configuredAmount
          : Number(coupon.discount ?? fallbackDiscount);

        return {
          ...coupon,
          code,
          discount: (Number.isFinite(discount) ? discount : 0).toFixed(2),
          discount_tax: Number(coupon.discount_tax || 0).toFixed(2),
          meta_data: metadata,
        };
      }));
      if (storeOrder) storeOrder.couponLines = hydrated;
      request.coupon_lines = hydrated;
      order.requestPayload = request;
    }));
  }
}
