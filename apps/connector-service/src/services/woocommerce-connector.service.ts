import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import crypto from 'crypto';
import { WooCommerceConnectionEntity } from '../entities/woocommerce-connection.entity';
import { WooCommerceSyncLogEntity } from '../entities/woocommerce-sync-log.entity';

@Injectable()
export class WooCommerceConnectorService implements OnModuleInit {
  private dataSource?: DataSource;
  private connRepo?: Repository<WooCommerceConnectionEntity>;
  private logRepo?: Repository<WooCommerceSyncLogEntity>;
  private isDbConnected = false;

  private inMemoryConns: WooCommerceConnectionEntity[] = [];
  private inMemoryLogs: WooCommerceSyncLogEntity[] = [];

  async onModuleInit() {
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [WooCommerceConnectionEntity, WooCommerceSyncLogEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.connRepo = this.dataSource.getRepository(WooCommerceConnectionEntity);
      this.logRepo = this.dataSource.getRepository(WooCommerceSyncLogEntity);
      this.isDbConnected = true;
      console.log('🐘 [WooCommerce Connector DB] Connected to PostgreSQL Database');
      await this.seedDefaultConnection();
    } catch (err: any) {
      console.log(`⚠️ [WooCommerce Connector DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
      this.seedInMemory();
    }
  }

  private async seedDefaultConnection() {
    if (this.connRepo) {
      const existing = await this.connRepo.findOne({ where: { storeId: 'STR-5001' } });
      if (!existing) {
        const conn = this.connRepo.create({
          id: 'WC-CONN-1001',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          storeUrl: 'https://pch.alekyatechsolutions.com',
          consumerKey: 'ck_demo_982347102934812390',
          consumerSecret: 'cs_demo_981234901238491023',
          webhookSecret: 'secret_wc_hmac_991823',
          autoSyncInventory: true,
          syncStatus: 'ACTIVE',
          lastSyncedAt: new Date(),
        });
        await this.connRepo.save(conn);
        console.log('🛒 [WooCommerce Engine] Seeded connection for pch.alekyatechsolutions.com');
      }
    }
  }

  private seedInMemory() {
    if (this.inMemoryConns.length === 0) {
      this.inMemoryConns.push({
        id: 'WC-CONN-1001',
        merchantId: 'MCH-1001',
        storeId: 'STR-5001',
        storeUrl: 'https://pch.alekyatechsolutions.com',
        consumerKey: 'ck_demo_982347102934812390',
        consumerSecret: 'cs_demo_981234901238491023',
        webhookSecret: 'secret_wc_hmac_991823',
        autoSyncInventory: true,
        syncStatus: 'ACTIVE',
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  // --- Validate HMAC SHA256 Webhook Signature ---
  verifyHmacSignature(rawBody: string, signature: string, secret: string): boolean {
    if (!signature || !secret) return true; // Dev mode bypass
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return expected === signature;
  }

  // --- Ingest WooCommerce Webhook ---
  async ingestWooCommerceWebhook(topic: string, body: any): Promise<WooCommerceSyncLogEntity> {
    const logId = `LOG-WC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const log: WooCommerceSyncLogEntity = {
      id: logId,
      merchantId: body.merchantId || 'MCH-1001',
      storeId: body.storeId || 'STR-5001',
      eventType: topic.toUpperCase(),
      externalId: body.id ? body.id.toString() : `WC-${Date.now()}`,
      status: 'SUCCESS',
      details: `Received WooCommerce webhook event '${topic}' for product/order '${body.name || body.id || 'Item'}'`,
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.logRepo) {
      const entity = this.logRepo.create(log);
      const saved = await this.logRepo.save(entity);
      console.log(`🛒 [WooCommerce Webhook Ingested] Event '${topic}' logged (ID: ${saved.id})`);
      return saved;
    } else {
      this.inMemoryLogs.unshift(log);
      return log;
    }
  }

  // --- Trigger Full Catalog Sync ---
  async triggerFullCatalogSync(storeId: string): Promise<{ success: boolean; syncedItemsCount: number; timestamp: string }> {
    const syncedItemsCount = 18; // Simulated 18 products synced from WooCommerce REST API
    await this.ingestWooCommerceWebhook('FULL_CATALOG_SYNC', { storeId, count: syncedItemsCount });
    return {
      success: true,
      syncedItemsCount,
      timestamp: new Date().toISOString(),
    };
  }

  async getConnection(storeId: string): Promise<WooCommerceConnectionEntity | null> {
    if (this.isDbConnected && this.connRepo) {
      return await this.connRepo.findOne({ where: { storeId } });
    }
    return this.inMemoryConns.find((c) => c.storeId === storeId) || null;
  }
}
