import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { DeliveryChannelEntity, DeliveryChannel } from './entities/delivery-channel.entity';
import { DeliveryOrderLogEntity, DeliveryOrderStatus } from './entities/delivery-order-log.entity';

@Injectable()
export class DeliveryConnectorRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private channelRepo?: Repository<DeliveryChannelEntity>;
  private orderLogRepo?: Repository<DeliveryOrderLogEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryChannels: DeliveryChannelEntity[] = [];
  private inMemoryOrders: DeliveryOrderLogEntity[] = [];

  async onModuleInit() {
      this.dataSource = await connectPostgres('Delivery Connector DB', [
        DeliveryChannelEntity,
        DeliveryOrderLogEntity,
      ]);
      this.channelRepo = this.dataSource.getRepository(DeliveryChannelEntity);
      this.orderLogRepo = this.dataSource.getRepository(DeliveryOrderLogEntity);
      this.isDbConnected = true;
      await this.seedDefaultChannels();

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [Delivery Connector Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Delivery Connector Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultChannels() {
    if (this.channelRepo) {
      const existing = await this.channelRepo.findOne({ where: { storeId: 'STR-5001' } });
      if (!existing) {
        const channels = [
          {
            id: 'CHAN-6001',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            channel: DeliveryChannel.DOORDASH,
            externalStoreId: 'DD-STORE-99',
            webhookSecret: 'secret_dd_key_882',
            autoAccept: true,
            defaultPrepTimeMinutes: 20,
            isEnabled: true,
          },
          {
            id: 'CHAN-6002',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            channel: DeliveryChannel.UBER_EATS,
            externalStoreId: 'UBER-STORE-44',
            webhookSecret: 'secret_uber_key_551',
            autoAccept: true,
            defaultPrepTimeMinutes: 15,
            isEnabled: true,
          },
        ];

        for (const ch of channels) {
          const entity = this.channelRepo.create(ch);
          await this.channelRepo.save(entity);
        }
        console.log('🛵 [Delivery Connector] Seeded default channels for DoorDash & Uber Eats');
      }
    }
  }

  private seedInMemory() {
    if (this.inMemoryChannels.length === 0) {
      this.inMemoryChannels.push(
        {
          id: 'CHAN-6001',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          channel: DeliveryChannel.DOORDASH,
          externalStoreId: 'DD-STORE-99',
          webhookSecret: 'secret_dd_key_882',
          autoAccept: true,
          defaultPrepTimeMinutes: 20,
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'CHAN-6002',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          channel: DeliveryChannel.UBER_EATS,
          externalStoreId: 'UBER-STORE-44',
          webhookSecret: 'secret_uber_key_551',
          autoAccept: true,
          defaultPrepTimeMinutes: 15,
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    }
  }

  async getChannelsByStore(storeId: string): Promise<DeliveryChannelEntity[]> {
    if (this.isDbConnected && this.channelRepo) {
      return await this.channelRepo.find({ where: { storeId } });
    }
    return this.inMemoryChannels.filter((c) => c.storeId === storeId);
  }

  async ingestDeliveryWebhook(channel: string, payload: any): Promise<DeliveryOrderLogEntity> {
    const id = `DEL-${Math.floor(10000 + Math.random() * 90000)}`;
    const orderLog: DeliveryOrderLogEntity = {
      id,
      merchantId: payload.merchantId || 'MCH-1001',
      storeId: payload.storeId || 'STR-5001',
      channel: channel.toUpperCase(),
      externalOrderId: payload.externalOrderId || `EXT-${Date.now()}`,
      customerName: payload.customerName || 'John Doe (Online Customer)',
      customerPhone: payload.customerPhone || '+1 (555) 000-9999',
      deliveryAddress: payload.deliveryAddress || { street: '789 Oak Ave', city: 'Austin', state: 'TX', zipCode: '78704' },
      driverName: payload.driverName || 'Michael (Uber Courier)',
      driverPhone: payload.driverPhone || '+1 (555) 333-2222',
      prepTimeMinutes: payload.prepTimeMinutes || 20,
      deliveryFee: payload.deliveryFee !== undefined ? Number(payload.deliveryFee) : 3.99,
      totalAmount: payload.totalAmount !== undefined ? Number(payload.totalAmount) : 34.50,
      orderItems: payload.orderItems || [{ name: 'Organic Whole Milk', qty: 2, price: 5.49 }, { name: 'Cheeseburger Deluxe', qty: 1, price: 14.99 }],
      status: DeliveryOrderStatus.RECEIVED,
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.orderLogRepo) {
      const entity = this.orderLogRepo.create(orderLog);
      const saved = await this.orderLogRepo.save(entity);
      await this.cacheDeliveryOrder(saved);
      console.log(`🛵 [Delivery Order Ingested] ${channel.toUpperCase()} Order #${saved.id} ($${saved.totalAmount}) for Store ${saved.storeId}`);
      return saved;
    } else {
      this.inMemoryOrders.unshift(orderLog);
      await this.cacheDeliveryOrder(orderLog);
      return orderLog;
    }
  }

  async getDeliveryOrders(storeId: string): Promise<DeliveryOrderLogEntity[]> {
    if (this.isDbConnected && this.orderLogRepo) {
      return await this.orderLogRepo.find({ where: { storeId }, order: { createdAt: 'DESC' } });
    }
    return this.inMemoryOrders.filter((o) => o.storeId === storeId);
  }

  async updateOrderStatus(orderId: string, status: DeliveryOrderStatus, prepTimeMinutes?: number): Promise<DeliveryOrderLogEntity | null> {
    let order: DeliveryOrderLogEntity | null = null;

    if (this.isDbConnected && this.orderLogRepo) {
      order = await this.orderLogRepo.findOne({ where: { id: orderId } });
      if (order) {
        order.status = status;
        if (prepTimeMinutes) order.prepTimeMinutes = prepTimeMinutes;
        order = await this.orderLogRepo.save(order);
      }
    } else {
      order = this.inMemoryOrders.find((o) => o.id === orderId) || null;
      if (order) {
        order.status = status;
        if (prepTimeMinutes) order.prepTimeMinutes = prepTimeMinutes;
      }
    }

    if (order) {
      await this.cacheDeliveryOrder(order);
    }
    return order;
  }

  private async cacheDeliveryOrder(order: DeliveryOrderLogEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`delivery:${order.id}`, JSON.stringify(order), 'EX', 86400);
      } catch {}
    }
  }
}
