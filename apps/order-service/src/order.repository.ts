import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { OrderEntity, OrderType, PaymentMethod, PaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';

@Injectable()
export class OrderRepository implements OnModuleInit {
  private dataSource!: DataSource;
  private orderRepo!: Repository<OrderEntity>;
  private itemRepo!: Repository<OrderItemEntity>;
  private historyRepo!: Repository<OrderStatusHistoryEntity>;
  private redisClient?: Redis;
  private isRedisConnected = false;

  async onModuleInit() {
    this.dataSource = await connectPostgres('Order Service DB', [
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
    ]);
    this.orderRepo = this.dataSource.getRepository(OrderEntity);
    this.itemRepo = this.dataSource.getRepository(OrderItemEntity);
    this.historyRepo = this.dataSource.getRepository(OrderStatusHistoryEntity);

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [Order Service Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Order Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  async createOrder(orderData: any): Promise<{ order: OrderEntity; items: OrderItemEntity[] }> {
    const id = `ORD-${Math.floor(10000 + Math.random() * 90000)}`;
    const orderNumber = `#${Math.floor(1000 + Math.random() * 9000)}`;

    let subtotal = 0;
    const items: OrderItemEntity[] = (orderData.items || []).map((i: any, idx: number) => {
      const lineTotal = Number(i.quantity || 1) * Number(i.unitPrice || 0);
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

    const taxAmount = orderData.taxAmount !== undefined ? Number(orderData.taxAmount) : Math.round(subtotal * 0.0825 * 100) / 100;
    const totalAmount = subtotal + taxAmount;

    const order: OrderEntity = {
      id,
      orderNumber,
      merchantId: orderData.merchantId || 'MCH-1001',
      storeId: orderData.storeId || 'STR-5001',
      shiftId: orderData.shiftId || 'SHIFT-8001',
      customerName: orderData.customerName || 'Walk-in Customer',
      customerPhone: orderData.customerPhone || '',
      orderType: orderData.orderType || OrderType.IN_STORE_POS,
      paymentMethod: orderData.paymentMethod || PaymentMethod.CASH,
      paymentStatus: orderData.paymentStatus || PaymentStatus.PAID,
      subtotal,
      taxAmount,
      discountAmount: 0.00,
      tipAmount: 0.00,
      totalAmount,
      orderStatus: OrderStatus.CREATED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const orderEntity = this.orderRepo.create(order);
    const savedOrder = await this.orderRepo.save(orderEntity);
    for (const item of items) {
      await this.itemRepo.save(this.itemRepo.create(item));
    }
    await this.recordStatusChange(id, 'NONE', OrderStatus.CREATED, 'POS System', 'Initial Order Creation');
    await this.cacheOrder(savedOrder);
    console.log(`🛍️ [Order Created] Order ${savedOrder.orderNumber} ($${savedOrder.totalAmount}) created for Store ${savedOrder.storeId}`);
    return { order: savedOrder, items };
  }

  async updateOrderStatus(orderId: string, toStatus: OrderStatus, changedBy: string, reason?: string): Promise<OrderEntity | null> {
    let order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (order) {
      const fromStatus = order.orderStatus;
      order.orderStatus = toStatus;
      order = await this.orderRepo.save(order);
      await this.recordStatusChange(orderId, fromStatus, toStatus, changedBy, reason);
    }

    if (order) {
      await this.cacheOrder(order);
      console.log(`🔄 [Order State Machine] Order #${orderId} transition: ${order.orderStatus} (by ${changedBy})`);
    }

    return order;
  }

  async getOrdersByStore(storeId: string): Promise<OrderEntity[]> {
    return this.orderRepo.find({ where: { storeId }, order: { createdAt: 'DESC' } });
  }

  async getOrderById(orderId: string): Promise<{ order: OrderEntity; items: OrderItemEntity[]; history: OrderStatusHistoryEntity[] } | null> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return null;
    const items = await this.itemRepo.find({ where: { orderId } });
    const history = await this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return { order, items, history };
  }

  private async recordStatusChange(orderId: string, fromStatus: string, toStatus: string, changedBy: string, reason?: string) {
    await this.historyRepo.save(this.historyRepo.create({
      id: `HST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId,
      fromStatus,
      toStatus,
      changedBy: changedBy || 'POS System',
      reason: reason || 'State Machine Transition',
      createdAt: new Date(),
    }));
  }

  private async cacheOrder(order: OrderEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`order:${order.id}`, JSON.stringify(order), 'EX', 86400);
      } catch {}
    }
  }
}
