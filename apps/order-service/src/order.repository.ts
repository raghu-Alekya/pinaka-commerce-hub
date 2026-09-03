import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { OrderEntity, OrderType, PaymentMethod, PaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';

@Injectable()
export class OrderRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private orderRepo?: Repository<OrderEntity>;
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
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [OrderEntity, OrderItemEntity, OrderStatusHistoryEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.orderRepo = this.dataSource.getRepository(OrderEntity);
      this.itemRepo = this.dataSource.getRepository(OrderItemEntity);
      this.historyRepo = this.dataSource.getRepository(OrderStatusHistoryEntity);
      this.isDbConnected = true;
      console.log('🐘 [Order Service DB] Connected to PostgreSQL Database');
    } catch (err: any) {
      console.log(`⚠️ [Order Service DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
    }

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

    if (this.isDbConnected && this.orderRepo && this.itemRepo) {
      const orderEntity = this.orderRepo.create(order);
      const savedOrder = await this.orderRepo.save(orderEntity);

      for (const item of items) {
        const itemEntity = this.itemRepo.create(item);
        await this.itemRepo.save(itemEntity);
      }

      await this.recordStatusChange(id, 'NONE', OrderStatus.CREATED, 'POS System', 'Initial Order Creation');
      await this.cacheOrder(savedOrder);
      console.log(`🛍️ [Order Created] Order ${savedOrder.orderNumber} ($${savedOrder.totalAmount}) created for Store ${savedOrder.storeId}`);
      return { order: savedOrder, items };
    } else {
      this.inMemoryOrders.unshift(order);
      this.inMemoryItems.push(...items);
      await this.recordStatusChange(id, 'NONE', OrderStatus.CREATED, 'POS System', 'Initial Order Creation');
      await this.cacheOrder(order);
      return { order, items };
    }
  }

  async updateOrderStatus(orderId: string, toStatus: OrderStatus, changedBy: string, reason?: string): Promise<OrderEntity | null> {
    let order: OrderEntity | null = null;

    if (this.isDbConnected && this.orderRepo) {
      order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (order) {
        const fromStatus = order.orderStatus;
        order.orderStatus = toStatus;
        order = await this.orderRepo.save(order);
        await this.recordStatusChange(orderId, fromStatus, toStatus, changedBy, reason);
      }
    } else {
      order = this.inMemoryOrders.find((o) => o.id === orderId) || null;
      if (order) {
        const fromStatus = order.orderStatus;
        order.orderStatus = toStatus;
        order.updatedAt = new Date();
        await this.recordStatusChange(orderId, fromStatus, toStatus, changedBy, reason);
      }
    }

    if (order) {
      await this.cacheOrder(order);
      console.log(`🔄 [Order State Machine] Order #${orderId} transition: ${order.orderStatus} (by ${changedBy})`);
    }

    return order;
  }

  async getOrdersByStore(storeId: string): Promise<OrderEntity[]> {
    if (this.isDbConnected && this.orderRepo) {
      return await this.orderRepo.find({ where: { storeId }, order: { createdAt: 'DESC' } });
    }
    return this.inMemoryOrders.filter((o) => o.storeId === storeId);
  }

  async getOrderById(orderId: string): Promise<{ order: OrderEntity; items: OrderItemEntity[]; history: OrderStatusHistoryEntity[] } | null> {
    let order: OrderEntity | null = null;
    let items: OrderItemEntity[] = [];
    let history: OrderStatusHistoryEntity[] = [];

    if (this.isDbConnected && this.orderRepo && this.itemRepo && this.historyRepo) {
      order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (order) {
        items = await this.itemRepo.find({ where: { orderId } });
        history = await this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
      }
    } else {
      order = this.inMemoryOrders.find((o) => o.id === orderId) || null;
      if (order) {
        items = this.inMemoryItems.filter((i) => i.orderId === orderId);
        history = this.inMemoryHistory.filter((h) => h.orderId === orderId);
      }
    }

    if (!order) return null;
    return { order, items, history };
  }

  private async recordStatusChange(orderId: string, fromStatus: string, toStatus: string, changedBy: string, reason?: string) {
    const entry: OrderStatusHistoryEntity = {
      id: `HST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId,
      fromStatus,
      toStatus,
      changedBy: changedBy || 'POS System',
      reason: reason || 'State Machine Transition',
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.historyRepo) {
      try {
        const entity = this.historyRepo.create(entry);
        await this.historyRepo.save(entity);
      } catch {}
    } else {
      this.inMemoryHistory.push(entry);
    }
  }

  private async cacheOrder(order: OrderEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`order:${order.id}`, JSON.stringify(order), 'EX', 86400);
      } catch {}
    }
  }
}
