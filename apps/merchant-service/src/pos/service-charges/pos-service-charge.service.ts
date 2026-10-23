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
import { SavePosServiceChargeDto } from './pos-service-charge.dto';

export interface PosServiceChargeRecord {
  id: string;
  storeId: string;
  merchantId: string;
  enabled: boolean;
  applyTo: string;
  defaultType: string;
  maxLimit: number;
  tiers: Array<{
    id: string;
    from: string;
    to: string;
    fee: string;
    feeType: string;
    appliesTo: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosServiceChargeService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; serviceCharge: PosServiceChargeRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Service charge settings are not configured for this store');
    return { success: true, serviceCharge: this.present(record) };
  }

  async create(storeId: string, body: SavePosServiceChargeDto) {
    const store = await this.requireStore(storeId);
    this.assertTiers(body);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Service charge settings already exist for this store');
    }
    const saved = await this.write(store.id, store.merchantId, body, null);
    return { success: true, serviceCharge: saved };
  }

  async update(storeId: string, body: SavePosServiceChargeDto) {
    const store = await this.requireStore(storeId);
    this.assertTiers(body);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Service charge settings are not configured for this store');
    const saved = await this.write(store.id, store.merchantId, body, current.id);
    return { success: true, serviceCharge: saved };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private assertTiers(body: SavePosServiceChargeDto) {
    if (!body.enabled) return;
    const incomplete = (body.tiers || []).some(item => !item.from?.trim() || !item.to?.trim() || !item.fee?.trim());
    if (incomplete) throw new BadRequestException('Each service charge tier needs a from, to, and fee');
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'service_charges');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosServiceChargeDto,
    _existingId: string | null,
  ): Promise<PosServiceChargeRecord> {
    const complete = (body.tiers || []).filter(item => item.from?.trim() && item.to?.trim() && item.fee?.trim());
    const saved = await savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'service_charges', {
      merchantId,
      enabled: body.enabled,
      applyTo: body.applyTo,
      defaultType: body.defaultType,
      maxLimit: Number(body.maxLimit),
      tiers: complete.map(item => ({
        id: randomUUID(),
        from: item.from.trim(),
        to: item.to.trim(),
        fee: item.fee.trim(),
        feeType: item.feeType,
        appliesTo: item.appliesTo,
      })),
    });
    return this.present(saved);
  }

  private present(record: Record<string, any>): PosServiceChargeRecord {
    const tiers = Array.isArray(record.tiers) ? record.tiers : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      enabled: Boolean(record.enabled),
      applyTo: record.applyTo,
      defaultType: record.defaultType,
      maxLimit: Number(record.maxLimit),
      tiers: tiers.map((item: Record<string, any>) => ({
        id: String(item.id),
        from: String(item.from ?? item.fromAmount),
        to: String(item.to ?? item.toAmount),
        fee: String(item.fee),
        feeType: item.feeType,
        appliesTo: item.appliesTo,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
