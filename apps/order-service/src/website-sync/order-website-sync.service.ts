import { createDecipheriv, createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { OrderRepository } from '../order.repository';
import { buildWooOrderPayload, findSyncedWebsiteOrder } from './order-website-sync.map';

const CONFIGURATION_NAME = 'order_website_sync';
const WEBSITE_ORDER_META_KEY = 'woocommerce_order_id';

@Injectable()
export class OrderWebsiteSyncService {
  constructor(
    @Inject(OrderRepository)
    private readonly orders: OrderRepository,
  ) {}

  async syncCreatedOrder(input: {
    orderId: string;
    storeId: string;
    clientOrderId?: string;
    customerName?: string;
    customerPhone?: string;
    request: Record<string, unknown>;
  }): Promise<void> {
    const database = this.orders.database();
    if (!database) {
      console.error(`[order-website-sync] ${JSON.stringify({
        orderId: input.orderId,
        clientOrderId: input.clientOrderId || null,
        called: true,
        reason: 'order database is unavailable',
      })}`);
      return;
    }
    try {
      const setting = await this.syncSetting(input.storeId);
      const enabled = this.settingEnabled(setting);
      console.log(`[order-website-sync] ${JSON.stringify({
        orderId: input.orderId,
        clientOrderId: input.clientOrderId || null,
        storeId: input.storeId,
        enabled,
        flag: setting ?? null,
      })}`);
      if (!enabled) return;
      const existing = await this.savedWebsiteOrderId(input.orderId);
      if (existing) {
        console.log(`[order-website-sync] ${JSON.stringify({
          orderId: input.orderId,
          websiteOrderId: existing,
          reason: 'website order already recorded',
        })}`);
        return;
      }
      const connection = await this.connection(input.storeId);
      if (!connection) {
        console.error(`[order-website-sync] ${JSON.stringify({
          orderId: input.orderId,
          storeId: input.storeId,
          reason: 'sync is enabled but no connected WordPress site was found',
        })}`);
        return;
      }
      const found = await this.findWebsiteOrder(connection, input.orderId, input.clientOrderId);
      if (found) {
        await this.rememberWebsiteOrder(input.orderId, found);
        console.log(`[order-website-sync] ${JSON.stringify({
          orderId: input.orderId,
          websiteOrderId: found,
          reason: 'matching website order already exists',
        })}`);
        return;
      }
      const created = await this.createWebsiteOrder(connection, buildWooOrderPayload(input));
      if (created) await this.rememberWebsiteOrder(input.orderId, created);
      console.log(`[order-website-sync] ${JSON.stringify({
        orderId: input.orderId,
        websiteOrderId: created ?? null,
        result: created ? 'created' : 'website response had no order id',
      })}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[order-website-sync] ${JSON.stringify({
        orderId: input.orderId,
        clientOrderId: input.clientOrderId || null,
        result: 'failed',
        error: message,
      })}`);
    }
  }

  async readEnabled(storeId: string): Promise<boolean> {
    return this.settingEnabled(await this.syncSetting(storeId));
  }

  async updateEnabled(storeId: string, enabled: boolean): Promise<{ storeId: string; enabled: boolean }> {
    const database = this.orders.database();
    if (!database) throw new BadRequestException('Order database is unavailable');
    await database.query(
      `INSERT INTO public.store_pos_configurations (store_id, configuration_name, configuration_value)
       VALUES ($1::uuid, $2, $3::jsonb)
       ON CONFLICT (store_id, configuration_name)
       DO UPDATE SET configuration_value = EXCLUDED.configuration_value, updated_at = now()`,
      [storeId, CONFIGURATION_NAME, JSON.stringify({ enabled })],
    );
    return { storeId, enabled };
  }

  private async syncSetting(storeId: string): Promise<unknown> {
    const database = this.orders.database();
    if (!database || !this.isUuid(storeId)) return undefined;
    const rows: Array<{ configuration_value?: unknown }> = await database.query(
      `SELECT configuration_value
         FROM public.store_pos_configurations
        WHERE store_id = $1::uuid
          AND configuration_name = $2
        LIMIT 1`,
      [storeId, CONFIGURATION_NAME],
    );
    return rows[0]?.configuration_value;
  }

  private settingEnabled(value: unknown): boolean {
    if (value === true) return true;
    const recordValue = record(value);
    return recordValue.enabled === true || recordValue.enabled === 'true';
  }

  private async savedWebsiteOrderId(orderId: string): Promise<number | undefined> {
    const database = this.orders.database();
    if (!database) return undefined;
    const rows: Array<{ meta_value?: unknown }> = await database.query(
      `SELECT meta_value
         FROM public.store_orders_meta
        WHERE order_id = $1::uuid AND meta_key = $2
        LIMIT 1`,
      [orderId, WEBSITE_ORDER_META_KEY],
    );
    const id = Number(rows[0]?.meta_value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }

  private async rememberWebsiteOrder(orderId: string, websiteOrderId: number): Promise<void> {
    const database = this.orders.database();
    if (!database) return;
    await database.query(
      `INSERT INTO public.store_orders_meta (order_id, meta_key, meta_value)
       VALUES ($1::uuid, $2, $3::jsonb)
       ON CONFLICT (order_id, meta_key)
       DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = now()`,
      [orderId, WEBSITE_ORDER_META_KEY, JSON.stringify(websiteOrderId)],
    );
  }

  private async connection(storeId: string): Promise<{ url: string; token: string } | undefined> {
    const database = this.orders.database();
    if (!database) return undefined;
    const rows: Array<{ wordpress_url?: string; encrypted_jwt?: string }> = await database.query(
      `SELECT wordpress_url, encrypted_jwt
         FROM public.website_connections
        WHERE store_id = $1 AND status = 'CONNECTED'
        LIMIT 1`,
      [storeId],
    );
    const row = rows[0];
    if (!row?.wordpress_url || !row.encrypted_jwt) return undefined;
    return { url: row.wordpress_url.replace(/\/+$/, ''), token: this.decryptToken(row.encrypted_jwt) };
  }

  private async findWebsiteOrder(
    connection: { url: string; token: string },
    orderId: string,
    clientOrderId?: string,
  ): Promise<number | undefined> {
    const search = String(clientOrderId || orderId).trim();
    if (!search) return undefined;
    const listed = await this.woo(connection, `orders?search=${encodeURIComponent(search)}&per_page=20`, 'GET');
    return findSyncedWebsiteOrder(listed, orderId);
  }

  private async createWebsiteOrder(
    connection: { url: string; token: string },
    payload: Record<string, unknown>,
  ): Promise<number | undefined> {
    const created = await this.woo(connection, 'orders', 'POST', payload);
    const id = Number(record(created).id);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }

  private async woo(
    connection: { url: string; token: string },
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const endpoint = path.split('?')[0];
    console.log(`[order-website-sync] ${JSON.stringify({ method, endpoint, request: 'started' })}`);
    const response = await fetch(`${connection.url}/wp-json/wc/v3/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const message = record(data).message || record(data).code || '';
    console.log(`[order-website-sync] ${JSON.stringify({
      method,
      endpoint,
      status: response.status,
      ok: response.ok,
      message: String(message).slice(0, 300),
    })}`);
    if (!response.ok) {
      const message = record(data).message || `WooCommerce returned HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return data;
  }

  private decryptToken(value: string): string {
    const saved = String(value || '').trim();
    if (saved.split('.').length === 3 && saved.startsWith('ey')) return saved;
    const [version, ivPart, ciphertextPart, tagPart] = saved.split(':');
    if (version !== 'v1' || !ivPart || !ciphertextPart || !tagPart) {
      throw new Error('The saved WordPress JWT is invalid');
    }
    const configured = process.env.STORE_CONFIG_ENCRYPTION_KEY;
    const key = configured
      ? Buffer.from(configured, 'base64')
      : createHash('sha256').update(process.env.AUTH_JWT_SECRET || 'pdh-local-development-secret-change-me').digest();
    if (key.length !== 32) throw new Error('STORE_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
