import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { InventoryAdjustmentEntity, AdjustmentType } from './entities/inventory-adjustment.entity';

@Injectable()
export class InventoryRepository implements OnModuleInit {
  private dataSource!: DataSource;
  private itemRepo!: Repository<InventoryItemEntity>;
  private adjRepo!: Repository<InventoryAdjustmentEntity>;
  private redisClient?: Redis;
  private isRedisConnected = false;

  async onModuleInit() {
    this.dataSource = await connectPostgres('Inventory DB', [InventoryItemEntity, InventoryAdjustmentEntity]);
    this.itemRepo = this.dataSource.getRepository(InventoryItemEntity);
    this.adjRepo = this.dataSource.getRepository(InventoryAdjustmentEntity);
    await this.seedDefaultInventory();

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('âš¡ [Inventory Redis] Connected to Redis for <1ms stock check');
    } catch (err: any) {
      console.log(`âš ï¸ [Inventory Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultInventory() {
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
        console.log('ðŸ“¦ [Inventory Service] Seeded default stock ledger for STR-5001');
      }
  }

  async getInventoryByStore(storeId: string): Promise<InventoryItemEntity[]> {
    return this.itemRepo.find({ where: { storeId }, order: { productName: 'ASC' } });
  }

  async getLowStockAlerts(storeId: string): Promise<InventoryItemEntity[]> {
    const all = await this.getInventoryByStore(storeId);
    return all.filter((i) => Number(i.quantityAvailable) <= Number(i.reorderPoint));
  }

  async decrementStock(storeId: string, productId: string, quantity: number, performedBy: string, reason?: string): Promise<{ success: boolean; item?: InventoryItemEntity; message?: string }> {
    let item = await this.itemRepo.findOne({ where: { storeId, productId } });
    if (item) {
      item.quantityOnHand = Number(item.quantityOnHand) - quantity;
      item.quantityAvailable = Number(item.quantityAvailable) - quantity;
      item = await this.itemRepo.save(item);
    }
    if (!item) {
      return { success: false, message: `Product '${productId}' not found in inventory for store '${storeId}'` };
    }
    await this.recordAdjustment(storeId, productId, AdjustmentType.POS_SALE, -quantity, item.quantityAvailable, performedBy, reason || 'POS / Online Sale');
    await this.cacheStock(storeId, productId, item.quantityAvailable);
    console.log(`ðŸ“‰ [Stock Decrement] Product '${productId}' (Store ${storeId}) reduced by ${quantity}. New Stock: ${item.quantityAvailable}`);
    return { success: true, item };
  }

  async adjustStock(storeId: string, productId: string, adjustmentType: AdjustmentType, quantityChange: number, performedBy: string, reason?: string): Promise<{ success: boolean; item?: InventoryItemEntity; message?: string }> {
    let item = await this.itemRepo.findOne({ where: { storeId, productId } });
    if (item) {
      item.quantityOnHand = Number(item.quantityOnHand) + quantityChange;
      item.quantityAvailable = Number(item.quantityAvailable) + quantityChange;
      item = await this.itemRepo.save(item);
    }
    if (!item) {
      return { success: false, message: `Product '${productId}' not found in inventory for store '${storeId}'` };
    }
    await this.recordAdjustment(storeId, productId, adjustmentType, quantityChange, item.quantityAvailable, performedBy, reason);
    await this.cacheStock(storeId, productId, item.quantityAvailable);
    return { success: true, item };
  }

  private async recordAdjustment(storeId: string, productId: string, type: AdjustmentType, qtyChange: number, newQty: number, performedBy: string, reason?: string) {
    await this.adjRepo.save(this.adjRepo.create({
      id: `ADJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      storeId,
      productId,
      adjustmentType: type,
      quantityChanged: qtyChange,
      newQuantityAvailable: newQty,
      performedBy,
      reason,
      createdAt: new Date(),
    }));
  }

  private async cacheStock(storeId: string, productId: string, qty: number) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`stock:${storeId}:${productId}`, qty.toString(), 'EX', 86400);
      } catch {}
    }
  }
}
