import { Controller, Get, Post, Patch, Body, Param, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { OrderStatus } from './entities/order.entity';

const orderRepository = new OrderRepository();
orderRepository.onModuleInit();

@Controller('api/v1/orders')
export class AppController {
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
  async createOrder(@Body() body: any) {
    if (!body.storeId || !body.items || body.items.length === 0) {
      throw new BadRequestException('storeId and at least 1 item are required to create an order');
    }
    const result = await orderRepository.createOrder(body);
    return {
      success: true,
      message: `Order ${result.order.orderNumber} created successfully!`,
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
    const orders = await orderRepository.getOrdersByStore(targetStore);
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
    const data = await orderRepository.getOrderById(id);
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
    const updated = await orderRepository.updateOrderStatus(id, body.status, body.changedBy || 'Cashier', body.reason);
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
    const cancelled = await orderRepository.updateOrderStatus(id, OrderStatus.CANCELLED, 'Manager', reason || 'Customer Requested Cancellation');
    if (!cancelled) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    return {
      success: true,
      message: `Order #${id} cancelled successfully!`,
      order: cancelled,
    };
  }
}
