import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createDecipheriv, createHash } from 'node:crypto';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { fetchPosTaxClasses, fetchPosTaxConfiguration } from '../../modules/store-pos-configuration/pos-tax-sync';
import { ensureStorePosConfigurationSchema } from '../../modules/store-pos-configuration/store-pos-configuration.schema';

type Connection = { wordpressUrl: string; wordpressJwt: string };
type RateInput = Record<string, any>;

@Injectable()
export class PosTaxClassService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private decrypt(value: string): string {
    try {
      const [version, iv, ciphertext, tag] = value.split(':');
      if (version !== 'v1' || !iv || !ciphertext || !tag) throw new Error();
      const key = process.env.STORE_CONFIG_ENCRYPTION_KEY
        ? Buffer.from(process.env.STORE_CONFIG_ENCRYPTION_KEY, 'base64')
        : createHash('sha256').update(process.env.AUTH_JWT_SECRET || 'pdh-local-development-secret-change-me').digest();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new BadRequestException('Save a fresh WordPress token in the store connector'); }
  }

  private async request(connection: Connection, method: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await fetch(connection.wordpressUrl.replace(/\/+$/, '') + '/wp-json/wc/v3/' + path, {
        method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.wordpressJwt },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
      });
    } catch { throw new BadGatewayException('Could not reach WordPress; check the store connector'); }
    let data: any;
    try { data = await response.json(); } catch { throw new BadGatewayException('WordPress returned invalid JSON'); }
    if (!response.ok) throw new BadGatewayException({ message: 'WordPress tax operation failed', wordpressStatus: response.status, wordpressCode: data?.code, wordpressMessage: data?.message });
    return data;
  }

  private rateInputs(input: Record<string, any>, creating: boolean): RateInput[] {
    const topKeys = ['name', 'rate', 'rates', 'country', 'state', 'postcode', 'city', 'priority', 'compound', 'shipping', 'order'];
    if (Object.keys(input).some(key => !topKeys.includes(key))) throw new BadRequestException('Unknown tax class field');
    if (input.rates !== undefined && input.rate !== undefined) throw new BadRequestException('Provide rate or rates, not both');
    let rates: unknown = input.rates ?? (input.rate !== undefined ? [{ ...input, name: undefined }] : []);
    if (!Array.isArray(rates) || (!creating && rates.length === 0)) throw new BadRequestException('Provide at least one tax rate');
    const ids = new Set<number>();
    return rates.map((item: any) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Each rate must be an object');
      const allowed = ['id', 'rate', 'name', 'country', 'state', 'postcode', 'city', 'priority', 'compound', 'shipping', 'order'];
      if (Object.keys(item).some(key => !allowed.includes(key) && item[key] !== undefined)) throw new BadRequestException('Unknown tax rate field');
      if (item.rate === undefined || item.rate === null || typeof item.rate === 'boolean' || String(item.rate).trim() === '' || !Number.isFinite(Number(item.rate)) || Number(item.rate) < 0 || Number(item.rate) > 100) throw new BadRequestException('Tax rate must be between 0 and 100');
      const rate: RateInput = { rate: String(item.rate) };
      for (const key of ['name', 'country', 'state', 'postcode', 'city']) {
        if (item[key] !== undefined) {
          if (typeof item[key] !== 'string') throw new BadRequestException(key + ' must be a string');
          rate[key] = item[key].trim();
        }
      }
      for (const key of ['priority', 'order']) {
        if (item[key] !== undefined) {
          if (!Number.isInteger(item[key]) || item[key] < (key === 'priority' ? 1 : 0)) throw new BadRequestException('Invalid ' + key);
          rate[key] = item[key];
        }
      }
      for (const key of ['compound', 'shipping']) {
        if (item[key] !== undefined) {
          if (typeof item[key] !== 'boolean') throw new BadRequestException(key + ' must be a boolean');
          rate[key] = item[key];
        }
      }
      if (item.id !== undefined) {
        if (creating || !Number.isInteger(item.id) || item.id < 1 || ids.has(item.id)) throw new BadRequestException('Invalid or duplicate tax rate ID');
        ids.add(item.id); rate.id = item.id;
      }
      return rate;
    });
  }

  private async refresh(storeId: string, connection: Connection, actorId?: string): Promise<{ taxEnabled: boolean; taxClasses: Awaited<ReturnType<typeof fetchPosTaxClasses>> }> {
    const configuration = await fetchPosTaxConfiguration(connection);
    const db = this.merchants.requireDataSource();
    await ensureStorePosConfigurationSchema(db);
    await db.query(`
      INSERT INTO public.store_pos_configurations (store_id,configuration_name,configuration_value,created_by,updated_by)
      VALUES ($1::uuid,'currency_taxes',$2::jsonb,$3::uuid,$3::uuid)
      ON CONFLICT (store_id,configuration_name) DO UPDATE
      SET configuration_value=COALESCE(store_pos_configurations.configuration_value,'{}'::jsonb) || EXCLUDED.configuration_value,
          updated_at=now(),updated_by=EXCLUDED.updated_by
    `, [storeId, JSON.stringify(configuration), actorId ?? null]);
    return configuration;
  }

  async execute(operation: 'list' | 'create' | 'update' | 'delete' | 'update-settings', storeId: string, slug: string | undefined, input: Record<string, any>, actor?: { id?: string; role?: string }) {
    if (actor?.role !== 'OWNER') throw new ForbiddenException('Only owners can manage WordPress tax classes');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Body must be an object');
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    const saved = await this.merchants.getWebsiteConnection(store.id);
    if (!saved?.wordpressUrl || !saved.encryptedJwt || saved.status !== 'CONNECTED') throw new BadRequestException('Connect and validate WordPress before managing taxes');
    const connection = { wordpressUrl: saved.wordpressUrl, wordpressJwt: this.decrypt(saved.encryptedJwt) };
    if (operation === 'list') return { success: true, store_id: store.id, ...await this.refresh(store.id, connection, actor.id) };
    if (operation === 'update-settings') {
      if (Object.keys(input).some(key => key !== 'taxEnabled') || typeof input.taxEnabled !== 'boolean') throw new BadRequestException('Provide taxEnabled as a boolean');
      await this.request(connection, 'PUT', 'settings/general/woocommerce_calc_taxes', { value: input.taxEnabled ? 'yes' : 'no' });
      try {
        return { success: true, store_id: store.id, ...await this.refresh(store.id, connection, actor.id) };
      } catch {
        throw new BadGatewayException('WordPress Enable Taxes was updated, but refreshing PCH failed. Run GET tax-classes/settings.');
      }
    }
    const classes = await fetchPosTaxClasses(connection);
    let current = classes.find(item => item.slug === slug);
    if (operation !== 'create' && !current) throw new NotFoundException('Tax class not found');
    let rates: RateInput[] = [];
    if (operation === 'create') {
      if (typeof input.name !== 'string' || !input.name.trim()) throw new BadRequestException('Tax class name is required');
      if (classes.some(item => item.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new ConflictException('Tax class name already exists');
      rates = this.rateInputs(input, true);
    } else if (operation === 'update') {
      if (input.name !== undefined && input.name !== current!.name) throw new BadRequestException('WooCommerce does not support renaming tax classes; update rates using the existing slug');
      rates = this.rateInputs(input, false);
      if (input.rate !== undefined && current!.rates.length > 1) throw new BadRequestException('Multiple regional rates exist; use rates with their IDs');
      if (input.rate !== undefined && current!.rates.length === 1) rates[0].id = current!.rates[0].id;
      for (const rate of rates) if (rate.id !== undefined && !current!.rates.some(item => item.id === rate.id)) throw new BadRequestException('Tax rate ID does not belong to this class');
    } else if (slug === 'standard') throw new BadRequestException('The built-in Standard class cannot be deleted');

    let changed = false;
    try {
      if (operation === 'create') {
        const created = await this.request(connection, 'POST', 'taxes/classes', { name: input.name.trim() });
        changed = true;
        if (typeof created.slug !== 'string' || !created.slug) throw new BadGatewayException('WordPress did not return the new tax class slug');
        slug = created.slug;
      }
      if (operation === 'delete') {
        await this.request(connection, 'DELETE', 'taxes/classes/' + encodeURIComponent(slug!) + '?force=true');
        changed = true;
      } else {
        for (const rate of rates) {
          const { id, ...body } = rate;
          await this.request(connection, id ? 'PUT' : 'POST', id ? 'taxes/' + id : 'taxes', { ...body, class: slug });
          changed = true;
        }
      }
    } catch (error) {
      if (changed) {
        try { await this.refresh(store.id, connection, actor.id); } catch { /* The caller can refresh using GET or product sync. */ }
      }
      throw error;
    }
    try {
      const { taxClasses, taxEnabled } = await this.refresh(store.id, connection, actor.id);
      return { success: true, store_id: store.id, taxEnabled, ...(operation === 'delete' ? { deleted_slug: slug } : { taxClass: taxClasses.find(item => item.slug === slug) }), taxClasses };
    } catch {
      throw new BadGatewayException('WordPress changes succeeded, but refreshing PCH failed. Run GET tax-classes or product sync before retrying a write.');
    }
  }
}
