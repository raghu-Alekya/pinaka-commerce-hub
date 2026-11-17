import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { readPosConfigDocument, savePosConfigDocument } from '../../modules/store-pos-configuration/store-pos-config-document';
import { SavePosCashbackDto } from './pos-cashback.dto';

export interface PosCashbackRecord {
  id: string;
  storeId: string;
  merchantId: string;
  enabled: boolean;
  maxCashback: number | null;
  tiers: Array<{ id: string; from: number; to: number; fee: number }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosCashbackService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; cashback: PosCashbackRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Cashback settings are not configured for this store');
    return { success: true, cashback: this.present(record) };
  }

  async create(storeId: string, body: SavePosCashbackDto) {
    const store = await this.requireStore(storeId);
    this.assertTiers(body);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Cashback settings already exist for this store');
    }
    return { success: true, cashback: await this.write(store.id, store.merchantId, body, null) };
  }

  async update(storeId: string, body: SavePosCashbackDto) {
    const store = await this.requireStore(storeId);
    this.assertTiers(body);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Cashback settings are not configured for this store');
    return { success: true, cashback: await this.write(store.id, store.merchantId, body, current.id) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private assertTiers(body: SavePosCashbackDto) {
    if (body.enabled && (body.maxCashback === undefined || body.maxCashback === null)) {
      throw new BadRequestException('Enter the maximum cashback limit');
    }
    if (!body.enabled) return;
    const incomplete = (body.tiers || []).some(item =>
      item.from === undefined || item.to === undefined || item.fee === undefined ||
      Number.isNaN(item.from) || Number.isNaN(item.to) || Number.isNaN(item.fee));
    if (incomplete) throw new BadRequestException('Each cashback tier needs a from, to, and fee');
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'cashback_settings');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCashbackDto,
    _existingId: string | null,
  ): Promise<PosCashbackRecord> {
    const complete = (body.tiers || []).filter(item =>
      item.from !== undefined && item.to !== undefined && item.fee !== undefined &&
      !Number.isNaN(Number(item.from)) && !Number.isNaN(Number(item.to)) && !Number.isNaN(Number(item.fee)));
    const saved = await savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'cashback_settings', {
      merchantId,
      enabled: body.enabled,
      maxCashback: body.maxCashback === undefined || body.maxCashback === null ? null : Number(body.maxCashback),
      tiers: complete.map(item => ({
        id: randomUUID(),
        from: Number(item.from),
        to: Number(item.to),
        fee: Number(item.fee),
      })),
    });
    return this.present(saved);
  }

  private present(record: Record<string, any>): PosCashbackRecord {
    const tiers = Array.isArray(record.tiers) ? record.tiers : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      enabled: Boolean(record.enabled),
      maxCashback: record.maxCashback === null || record.maxCashback === undefined ? null : Number(record.maxCashback),
      tiers: tiers.map((item: Record<string, any>) => ({
        id: String(item.id),
        from: Number(item.from ?? item.fromAmount),
        to: Number(item.to ?? item.toAmount),
        fee: Number(item.fee),
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
