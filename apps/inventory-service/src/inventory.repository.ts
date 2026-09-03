import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { InventoryAdjustmentEntity, AdjustmentType } from './entities/inventory-adjustment.entity';

@Injectable()
export class InventoryRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private itemRepo?: Repository<InventoryItemEntity>;
  private adjRepo?: Repository<InventoryAdjustmentEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryItems: InventoryItemEntity[] = [];
  private inMemoryAdjustments: InventoryAdjustmentEntity[] = [];

  async onModuleInit() {
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [InventoryItemEntity, InventoryAdjustmentEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.itemRepo = this.dataSource.getRepository(InventoryItemEntity);
      this.adjRepo = this.dataSource.getRepository(InventoryAdjustmentEntity);
      this.isDbConnected = true;
      console.log('🐘 [Inventory DB] Connected to PostgreSQL Database');
      await this.seedDefaultInventory();
    } catch (err: any) {
      console.log(`⚠️ [Inventory DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
      this.seedInMemory();
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
      console.log('⚡ [Inventory Redis] Connected to Redis for <1ms stock check');
    } catch (err: any) {
      console.log(`⚠️ [Inventory Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultInventory() {
    if (this.itemRepo) {
      const existing = await this.itemRepo.findOne({ where: { storeId: 'STR-5001' } });
      if (!existing) {
        const items = [
          {
            id: 'INV-7001',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            productId: 'MILK-ORG-1G',
            productName: 'Organic Whole Milk 1 Gal',
            quantityOnHand: 50.00,
            quantityReserved: 0.00,
            quantityAvailable: 50.00,
            reorderPoint: 10.00,
            unitCost: 3.20,
            unitPrice: 5.49,
          },
          {
            id: 'INV-7002',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            productId: '4131',
            productName: 'Gala Apples (Fresh Produce)',
            quantityOnHand: 100.00,
            quantityReserved: 0.00,
            quantityAvailable: 100.00,
            reorderPoint: 20.00,
            unitCost: 0.85,
            unitPrice: 1.99,
          },
        ];

        for (const item of items) {
          const entity = this.itemRepo.create(item);
          await this.itemRepo.save(entity);
          await this.cacheStock(item.storeId, item.productId, item.quantityAvailable);
        }
        console.log('📦 [Inventory Service] Seeded default stock ledger for STR-5001');
      }
    }
  }

  private seedInMemory() {
    if (this.inMemoryItems.length === 0) {
      this.inMemoryItems.push(
        {
          id: 'INV-7001',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          productId: 'MILK-ORG-1G',
          productName: 'Organic Whole Milk 1 Gal',
          quantityOnHand: 50.00,
          quantityReserved: 0.00,
          quantityAvailable: 50.00,
          reorderPoint: 10.00,
          unitCost: 3.20,
          unitPrice: 5.49,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'INV-7002',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          productId: '4131',
          productName: 'Gala Apples (Fresh Produce)',
          quantityOnHand: 100.00,
          quantityReserved: 0.00,
          quantityAvailable: 100.00,
          reorderPoint: 20.00,
          unitCost: 0.85,
          unitPrice: 1.99,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    }
  }

  async getInventoryByStore(storeId: string): Promise<InventoryItemEntity[]> {
    if (this.isDbConnected && this.itemRepo) {
      return await this.itemRepo.find({ where: { storeId }, order: { productName: 'ASC' } });
    }
    return this.inMemoryItems.filter((i) => i.storeId === storeId);
  }

  async getLowStockAlerts(storeId: string): Promise<InventoryItemEntity[]> {
    const all = await this.getInventoryByStore(storeId);
    return all.filter((i) => Number(i.quantityAvailable) <= Number(i.reorderPoint));
  }

  async decrementStock(storeId: string, productId: string, quantity: number, performedBy: string, reason?: string): Promise<{ success: boolean; item?: InventoryItemEntity; message?: string }> {
    let item: InventoryItemEntity | null = null;

    if (this.isDbConnected && this.itemRepo) {
      item = await this.itemRepo.findOne({ where: { storeId, productId } });
      if (item) {
        item.quantityOnHand = Number(item.quantityOnHand) - quantity;
        item.quantityAvailable = Number(item.quantityAvailable) - quantity;
        item = await this.itemRepo.save(item);
      }
    } else {
      item = this.inMemoryItems.find((i) => i.storeId === storeId && i.productId === productId) || null;
      if (item) {
        item.quantityOnHand = Number(item.quantityOnHand) - quantity;
        item.quantityAvailable = Number(item.quantityAvailable) - quantity;
        item.updatedAt = new Date();
      }
    }

    if (!item) {
      return { success: false, message: `Product '${productId}' not found in inventory for store '${storeId}'` };
    }

    // Record Stock Adjustment Audit Log
    await this.recordAdjustment(storeId, productId, AdjustmentType.POS_SALE, -quantity, item.quantityAvailable, performedBy, reason || 'POS / Online Sale');
    await this.cacheStock(storeId, productId, item.quantityAvailable);

    console.log(`📉 [Stock Decrement] Product '${productId}' (Store ${storeId}) reduced by ${quantity}. New Stock: ${item.quantityAvailable}`);
    return { success: true, item };
  }

  async adjustStock(storeId: string, productId: string, adjustmentType: AdjustmentType, quantityChange: number, performedBy: string, reason?: string): Promise<{ success: boolean; item?: InventoryItemEntity; message?: string }> {
    let item: InventoryItemEntity | null = null;

    if (this.isDbConnected && this.itemRepo) {
      item = await this.itemRepo.findOne({ where: { storeId, productId } });
      if (item) {
        item.quantityOnHand = Number(item.quantityOnHand) + quantityChange;
        item.quantityAvailable = Number(item.quantityAvailable) + quantityChange;
        item = await this.itemRepo.save(item);
      }
    } else {
      item = this.inMemoryItems.find((i) => i.storeId === storeId && i.productId === productId) || null;
      if (item) {
        item.quantityOnHand = Number(item.quantityOnHand) + quantityChange;
        item.quantityAvailable = Number(item.quantityAvailable) + quantityChange;
        item.updatedAt = new Date();
      }
    }

    if (!item) {
      return { success: false, message: `Product '${productId}' not found in inventory for store '${storeId}'` };
    }

    await this.recordAdjustment(storeId, productId, adjustmentType, quantityChange, item.quantityAvailable, performedBy, reason);
    await this.cacheStock(storeId, productId, item.quantityAvailable);

    return { success: true, item };
  }

  private async recordAdjustment(storeId: string, productId: string, type: AdjustmentType, qtyChange: number, newQty: number, performedBy: string, reason?: string) {
    const entry: InventoryAdjustmentEntity = {
      id: `ADJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      storeId,
      productId,
      adjustmentType: type,
      quantityChanged: qtyChange,
      newQuantityAvailable: newQty,
      performedBy,
      reason,
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.adjRepo) {
      try {
        const entity = this.adjRepo.create(entry);
        await this.adjRepo.save(entity);
      } catch {}
    } else {
      this.inMemoryAdjustments.unshift(entry);
    }
  }

  private async cacheStock(storeId: string, productId: string, qty: number) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`stock:${storeId}:${productId}`, qty.toString(), 'EX', 86400);
      } catch {}
    }
  }
}
