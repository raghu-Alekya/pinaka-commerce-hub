import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { MenuItemEntity } from './entities/menu-item.entity';
import { MenuSyncAuditEntity } from './entities/menu-sync-audit.entity';

const CACHE_TTL_SECONDS = 600; // 10 minutes cache TTL

@Injectable()
export class MenuRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private menuRepo?: Repository<MenuItemEntity>;
  private syncAuditRepo?: Repository<MenuSyncAuditEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;
  private inMemoryStore: MenuItemEntity[] = [];

  async onModuleInit() {
    // 1. PostgreSQL Connection
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_commerce_hub',
        entities: [MenuItemEntity, MenuSyncAuditEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.menuRepo = this.dataSource.getRepository(MenuItemEntity);
      this.syncAuditRepo = this.dataSource.getRepository(MenuSyncAuditEntity);
      this.isDbConnected = true;
      console.log('🐘 [Menu PostgreSQL] Connected to Database: pinaka_delivery_hub');
      await this.seedDefaultMenu();
    } catch (err: any) {
      console.log(`⚠️ [Menu PostgreSQL] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
      this.seedDefaultMenuInMemory();
    }

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
      console.log('⚡ [Menu Redis] Connected to Redis Container on port 6379');
    } catch (err: any) {
      console.log(`⚠️ [Menu Redis] Offline (${err.message}). Proceeding without cache.`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultMenu() {
    if (this.menuRepo) {
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
        console.log('🍔 [Menu Service] Seeded default menu items for STORE-01');
      }
    }
  }

  private seedDefaultMenuInMemory() {
    if (this.inMemoryStore.length === 0) {
      this.inMemoryStore.push(
        {
          id: 'uuid-101',
          merchantId: 'STORE-01',
          externalItemId: 'ITEM-101',
          name: 'Cheeseburger Deluxe',
          description: 'Juicy beef patty with cheddar cheese, lettuce, and secret sauce',
          category: 'Burgers',
          price: 14.99,
          isAvailable: true,
          platformOverrides: { doordashPrice: 15.99, swiggyPrice: 15.99 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'uuid-102',
          merchantId: 'STORE-01',
          externalItemId: 'ITEM-102',
          name: 'Truffle Fries',
          description: 'Crispy fries tossed in parmesan and black truffle oil',
          category: 'Sides',
          price: 8.50,
          isAvailable: true,
          platformOverrides: { doordashPrice: 9.00, swiggyPrice: 9.00 },
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    }
  }

  async getMenuByMerchant(merchantId: string): Promise<MenuItemEntity[]> {
    // 1. Check Redis Cache
    const cached = await this.getCache<MenuItemEntity[]>(`menu:${merchantId}`);
    if (cached) {
      console.log(`⚡ [Redis Cache HIT] Served Menu for Store #${merchantId} in <1ms`);
      return cached;
    }

    // 2. Query Database
    let items: MenuItemEntity[] = [];
    if (this.isDbConnected && this.menuRepo) {
      try {
        items = await this.menuRepo.find({ where: { merchantId }, order: { category: 'ASC', name: 'ASC' } });
      } catch {
        // Fallback
      }
    }

    if (items.length === 0) {
      items = this.inMemoryStore.filter((i) => i.merchantId === merchantId);
    }

    // Save to Cache
    await this.setCache(`menu:${merchantId}`, items);
    return items;
  }

  async saveMenuItem(merchantId: string, itemData: Partial<MenuItemEntity>): Promise<MenuItemEntity> {
    let saved: MenuItemEntity;

    if (this.isDbConnected && this.menuRepo) {
      let entity = await this.menuRepo.findOne({ where: { merchantId, externalItemId: itemData.externalItemId } });
      if (!entity) {
        entity = this.menuRepo.create({ ...itemData, merchantId });
      } else {
        Object.assign(entity, itemData);
      }
      saved = await this.menuRepo.save(entity);
    } else {
      const idx = this.inMemoryStore.findIndex((i) => i.merchantId === merchantId && i.externalItemId === itemData.externalItemId);
      const entry: MenuItemEntity = {
        id: itemData.id || `uuid-${Date.now()}`,
        merchantId,
        externalItemId: itemData.externalItemId || `ITEM-${Date.now()}`,
        name: itemData.name || 'New Menu Item',
        description: itemData.description || '',
        category: itemData.category || 'Mains',
        price: Number(itemData.price) || 9.99,
        isAvailable: itemData.isAvailable ?? true,
        platformOverrides: itemData.platformOverrides || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (idx >= 0) this.inMemoryStore[idx] = entry;
      else this.inMemoryStore.unshift(entry);
      saved = entry;
    }

    // Invalidate Redis Cache
    await this.deleteCache(`menu:${merchantId}`);
    return saved;
  }

  async set86ItemStatus(merchantId: string, externalItemId: string, isAvailable: boolean): Promise<MenuItemEntity | null> {
    let targetItem: MenuItemEntity | null = null;

    if (this.isDbConnected && this.menuRepo) {
      const entity = await this.menuRepo.findOne({ where: { merchantId, externalItemId } });
      if (entity) {
        entity.isAvailable = isAvailable;
        targetItem = await this.menuRepo.save(entity);
      }
    } else {
      const item = this.inMemoryStore.find((i) => i.merchantId === merchantId && i.externalItemId === externalItemId);
      if (item) {
        item.isAvailable = isAvailable;
        item.updatedAt = new Date();
        targetItem = item;
      }
    }

    if (targetItem) {
      await this.deleteCache(`menu:${merchantId}`);
      console.log(`🚫 [86-Item Updated] Item #${externalItemId} for Store #${merchantId} -> Available: ${isAvailable}`);
    }

    return targetItem;
  }

  async recordSyncAudit(merchantId: string, count: number): Promise<MenuSyncAuditEntity | null> {
    if (this.isDbConnected && this.syncAuditRepo) {
      try {
        const auditLog = this.syncAuditRepo.create({
          merchantId,
          synchronizedItems: count,
          status: 'MENU_SYNCHRONIZED_TO_ALL_PLATFORMS',
          platforms: ['DOORDASH', 'SWIGGY'],
        });
        const saved = await this.syncAuditRepo.save(auditLog);
        console.log(`📄 [PostgreSQL Audit Logged] Menu Sync Log Saved to PostgreSQL Table 'menu_sync_logs' (ID: ${saved.id})`);
        return saved;
      } catch (err: any) {
        console.error(`⚠️ DB Sync Audit Save Error: ${err.message}`);
      }
    }
    return null;
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
