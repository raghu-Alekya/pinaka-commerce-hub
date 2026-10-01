import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { MenuItemEntity } from './entities/menu-item.entity';
import { MenuSyncAuditEntity } from './entities/menu-sync-audit.entity';

const CACHE_TTL_SECONDS = 600; // 10 minutes cache TTL

@Injectable()
export class MenuRepository implements OnModuleInit {
  private dataSource!: DataSource;
  private menuRepo!: Repository<MenuItemEntity>;
  private syncAuditRepo!: Repository<MenuSyncAuditEntity>;
  private redisClient?: Redis;
  private isRedisConnected = false;

  async onModuleInit() {
    this.dataSource = await connectPostgres('Menu PostgreSQL', [MenuItemEntity, MenuSyncAuditEntity]);
    this.menuRepo = this.dataSource.getRepository(MenuItemEntity);
    this.syncAuditRepo = this.dataSource.getRepository(MenuSyncAuditEntity);
    await this.seedDefaultMenu();

    // 2. Redis Connection
    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });

      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('âš¡ [Menu Redis] Connected to Redis Container on port 6379');
    } catch (err: any) {
      console.log(`âš ï¸ [Menu Redis] Offline (${err.message}). Proceeding without cache.`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultMenu() {
    const existing = await this.menuRepo.findOne({ where: { merchantId: 'STORE-01' } });
      if (!existing) {
        const defaultItems = [
          {
            merchantId: 'STORE-01',
            externalItemId: 'ITEM-101',
            name: 'Cheeseburger Deluxe',
            description: 'Juicy beef patty with cheddar cheese, lettuce, and secret sauce',
            category: 'Burgers',
            price: 14.99,
            isAvailable: true,
            platformOverrides: { doordashPrice: 15.99, swiggyPrice: 15.99 },
          },
          {
            merchantId: 'STORE-01',
            externalItemId: 'ITEM-102',
            name: 'Truffle Fries',
            description: 'Crispy fries tossed in parmesan and black truffle oil',
            category: 'Sides',
            price: 8.50,
            isAvailable: true,
            platformOverrides: { doordashPrice: 9.00, swiggyPrice: 9.00 },
          },
        ];

        for (const item of defaultItems) {
          const entity = this.menuRepo.create(item);
          await this.menuRepo.save(entity);
        }
        console.log('ðŸ” [Menu Service] Seeded default menu items for STORE-01');
      }
  }

  async getMenuByMerchant(merchantId: string): Promise<MenuItemEntity[]> {
    const cached = await this.getCache<MenuItemEntity[]>(`menu:${merchantId}`);
    if (cached) {
      console.log(`âš¡ [Redis Cache HIT] Served Menu for Store #${merchantId} in <1ms`);
      return cached;
    }
    const items = await this.menuRepo.find({ where: { merchantId }, order: { category: 'ASC', name: 'ASC' } });
    await this.setCache(`menu:${merchantId}`, items);
    return items;
  }

  async saveMenuItem(merchantId: string, itemData: Partial<MenuItemEntity>): Promise<MenuItemEntity> {
    let entity = await this.menuRepo.findOne({ where: { merchantId, externalItemId: itemData.externalItemId } });
    if (!entity) {
      entity = this.menuRepo.create({ ...itemData, merchantId });
    } else {
      Object.assign(entity, itemData);
    }
    const saved = await this.menuRepo.save(entity);
    await this.deleteCache(`menu:${merchantId}`);
    return saved;
  }

  async set86ItemStatus(merchantId: string, externalItemId: string, isAvailable: boolean): Promise<MenuItemEntity | null> {
    const entity = await this.menuRepo.findOne({ where: { merchantId, externalItemId } });
    if (!entity) return null;
    entity.isAvailable = isAvailable;
    const targetItem = await this.menuRepo.save(entity);
    await this.deleteCache(`menu:${merchantId}`);
    console.log(`ðŸš« [86-Item Updated] Item #${externalItemId} for Store #${merchantId} -> Available: ${isAvailable}`);
    return targetItem;
  }

  async recordSyncAudit(merchantId: string, count: number): Promise<MenuSyncAuditEntity | null> {
    const saved = await this.syncAuditRepo.save(this.syncAuditRepo.create({
      merchantId,
      synchronizedItems: count,
      status: 'MENU_SYNCHRONIZED_TO_ALL_PLATFORMS',
      platforms: ['DOORDASH', 'SWIGGY'],
    }));
    console.log(`ðŸ“„ [PostgreSQL Audit Logged] Menu Sync Log Saved (ID: ${saved.id})`);
    return saved;
  }

  private async getCache<T>(key: string): Promise<T | null> {
    if (!this.isRedisConnected || !this.redisClient) return null;
    try {
      const data = await this.redisClient.get(key);
      return data ? (JSON.parse(data) as T) : null;
    } catch {
      return null;
    }
  }

  private async setCache(key: string, value: any): Promise<void> {
    if (!this.isRedisConnected || !this.redisClient) return;
    try {
      await this.redisClient.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Ignore cache write error
    }
  }

  private async deleteCache(key: string): Promise<void> {
    if (!this.isRedisConnected || !this.redisClient) return;
    try {
      await this.redisClient.del(key);
    } catch {
      // Ignore cache delete error
    }
  }
}
