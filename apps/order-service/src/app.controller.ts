import { Controller, Get, Post, Patch, Body, Param, Query, Headers, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { OrderStatus, OrderType, PaymentMethod, PaymentStatus } from './entities/order.entity';

@Controller(['api/v1/orders', 'connector/api/v1/orders'])
export class AppController {
  constructor(
    @Inject(OrderRepository)
    private readonly orderRepository: OrderRepository,
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

  // --- 1. Create New Order (POS / Web / Online Delivery) ---
  @Post()
  async createOrder(
    @Body() body: any,
    @Headers('x-store-id') storeHeader?: string,
    @Headers('x-merchant-id') merchantHeader?: string,
  ) {
    const wordpressCompatible = Array.isArray(body?.line_items);
    const normalized = this.normalizeCreateOrder(body, storeHeader, merchantHeader);
    if (!normalized.storeId || !normalized.items.length) {
      throw new BadRequestException('storeId and at least 1 item are required to create an order');
    }
    const result = await this.orderRepository.createOrder(normalized);
    if (wordpressCompatible) {
      return this.toWordPressCompatibleResponse(result, result.order.requestPayload || body);
    }
    return {
      success: true,
      message: result.duplicate
        ? `Order ${result.order.orderNumber} was already synced.`
        : `Order ${result.order.orderNumber} created successfully!`,
      duplicate: result.duplicate,
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      order: result.order,
      items: result.items,
    };
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

  // --- 3. Get Single Order Detail with Items & State History ---
  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    const data = await this.orderRepository.getOrderById(id);
    if (!data) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    return {
      success: true,
      order: data.order,
      items: data.items,
      history: data.history,
    };
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

  // --- 5. Cancel Order ---
  @Post(':id/cancel')
  async cancelOrder(@Param('id') id: string, @Body('reason') reason: string) {
    const cancelled = await this.orderRepository.updateOrderStatus(id, OrderStatus.CANCELLED, 'Manager', reason || 'Customer Requested Cancellation');
    if (!cancelled) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    return {
      success: true,
      message: `Order #${id} cancelled successfully!`,
      order: cancelled,
    };
  }

  private toWordPressCompatibleResponse(
    result: { order: any; items: any[]; duplicate: boolean },
    request: any,
  ) {
    const { order, items } = result;
    const createdAt = new Date(order.createdAt);
    const updatedAt = new Date(order.updatedAt);
    const iso = (value: Date) => value.toISOString().replace(/\.\d{3}Z$/, '');
    const money = (value: unknown) => Number(value || 0).toFixed(2);
    const address = (value: any = {}) => ({
      first_name: value.first_name || '',
      last_name: value.last_name || '',
      company: value.company || '',
      address_1: value.address_1 || '',
      address_2: value.address_2 || '',
      city: value.city || '',
      state: value.state || '',
      postcode: value.postcode || '',
      country: value.country || '',
      email: value.email || '',
      phone: value.phone || '',
    });
    const metadata = (Array.isArray(order.metadata) ? order.metadata : []).map(
      (entry: any, index: number) => ({ id: index + 1, key: entry.key, value: entry.value }),
    );
    const lineItems = items.map((item: any, index: number) => {
      const original = request.line_items?.[index] || {};
      const itemMetadata = (Array.isArray(item.modifiers) ? item.modifiers : []).map(
        (entry: any, metaIndex: number) => ({
          id: metaIndex + 1,
          key: entry.key,
          value: entry.value,
          display_key: entry.display_key ?? entry.key,
          display_value: entry.display_value ?? entry.value,
        }),
      );
      const numericProductId = Number(item.productId);
      return {
        id: item.id,
        name: item.productName,
        product_id: Number.isSafeInteger(numericProductId) ? numericProductId : item.productId,
        variation_id: Number(original.variation_id || 0),
        quantity: Number(item.quantity),
        tax_class: original.tax_class || '',
        subtotal: money(original.subtotal ?? item.totalPrice),
        subtotal_tax: money(original.subtotal_tax),
        total: money(item.totalPrice),
        total_tax: money(original.total_tax),
        taxes: Array.isArray(original.taxes) ? original.taxes : [],
        meta_data: itemMetadata,
        sku: original.sku ?? null,
        global_unique_id: original.global_unique_id ?? null,
        price: Number(item.unitPrice),
        image: original.image || { id: 0, src: '' },
        parent_name: original.parent_name ?? null,
        product_data: original.product_data ?? null,
      };
    });
    const completed = order.orderStatus === OrderStatus.COMPLETED;
    const paid = order.paymentStatus === PaymentStatus.PAID;
    const basePath = `/api/v1/orders/${order.id}`;

    return {
      id: order.id,
      parent_id: request.parent_id || 0,
      status: String(order.orderStatus).toLowerCase(),
      currency: request.currency || 'INR',
      version: 'PCH-2.0.0',
      prices_include_tax: Boolean(request.prices_include_tax),
      date_created: iso(createdAt),
      date_modified: iso(updatedAt),
      discount_total: money(order.discountAmount),
      discount_tax: money(request.discount_tax),
      shipping_total: money(request.shipping_total),
      shipping_tax: money(request.shipping_tax),
      cart_tax: money(request.cart_tax),
      total: money(order.totalAmount),
      total_tax: money(order.taxAmount),
      customer_id: request.customer_id || 0,
      order_key: `pch_order_${order.id}`,
      billing: address(request.billing),
      shipping: address(request.shipping),
      payment_method: request.payment_method || String(order.paymentMethod).toLowerCase(),
      payment_method_title: request.payment_method_title || order.paymentMethod,
      transaction_id: request.transaction_id || '',
      customer_ip_address: request.customer_ip_address || '',
      customer_user_agent: request.customer_user_agent || '',
      created_via: 'pch-rest-api',
      customer_note: request.customer_note || '',
      date_completed: completed ? iso(updatedAt) : null,
      date_paid: paid ? iso(updatedAt) : null,
      cart_hash: request.cart_hash || '',
      number: String(order.orderNumber).replace(/^#/, ''),
      meta_data: metadata,
      line_items: lineItems,
      tax_lines: Array.isArray(request.tax_lines) ? request.tax_lines : [],
      shipping_lines: Array.isArray(request.shipping_lines) ? request.shipping_lines : [],
      fee_lines: Array.isArray(request.fee_lines) ? request.fee_lines : [],
      coupon_lines: Array.isArray(request.coupon_lines) ? request.coupon_lines : [],
      refunds: [],
      payment_url: '',
      is_editable: !completed,
      needs_payment: !paid,
      needs_processing: !completed,
      date_created_gmt: iso(createdAt),
      date_modified_gmt: iso(updatedAt),
      date_completed_gmt: completed ? iso(updatedAt) : null,
      date_paid_gmt: paid ? iso(updatedAt) : null,
      currency_symbol: request.currency_symbol || (request.currency === 'USD' ? '$' : '₹'),
      duplicate: result.duplicate,
      _links: {
        self: [{ href: basePath, targetHints: { allow: ['GET', 'PATCH'] } }],
        collection: [{ href: '/api/v1/orders' }],
      },
    };
  }

  private normalizeCreateOrder(body: any, storeHeader?: string, merchantHeader?: string) {
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
    const status = String(body?.status || '').toUpperCase();
    const method = String(body?.payment_method || body?.paymentMethod || 'CASH').toUpperCase();
    return {
      ...body,
      storeId: storeHeader || body?.storeId || body?.store_id,
      merchantId: merchantHeader || body?.merchantId || body?.merchant_id,
      shiftId: String(body?.shift_id ?? body?.shiftId ?? metaValue('shift_id') ?? '').trim() || undefined,
      localShiftId: String(body?.local_shift_id ?? body?.localShiftId ?? metaValue('local_shift_id') ?? ''),
      clientOrderId: String(metaValue('_pos_client_order_id') ?? body?.clientOrderId ?? ''),
      offline: Boolean(body?.offline ?? metaValue('offline') ?? metaValue('is_offline')),
      metadata,
      requestPayload: body,
      source: Array.isArray(body?.line_items) ? 'WORDPRESS_COMPATIBLE' : 'PCH',
      items,
      subtotal: body?.subtotal !== undefined ? Number(body.subtotal) : lineSubtotal,
      taxAmount: Number(body?.taxAmount ?? metaValue('_pos_order_tax') ?? 0),
      discountAmount: Number(body?.discountAmount ?? metaValue('_merchant_discount') ?? 0),
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
}
