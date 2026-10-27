import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { PosConfigurationImageService } from '../../modules/store-pos-configuration/pos-configuration-image.service';
import { readPosConfigDocument, savePosConfigDocument } from '../../modules/store-pos-configuration/store-pos-config-document';
import { PosCashDenominationItemDto, SavePosCashDenominationDto } from './pos-cash-denomination.dto';

export interface PosCashDenominationItem {
  id: string;
  amount: number;
  imageName: string;
  imageData: string;
}

export interface PosCashDenominationRecord {
  id: string;
  storeId: string;
  merchantId: string;
  cashDenominations: PosCashDenominationItem[];
  coinDenominations: PosCashDenominationItem[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosCashDenominationService {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(PosConfigurationImageService) private readonly images: PosConfigurationImageService,
  ) {}

  async get(storeId: string): Promise<{ success: true; cashDenominations: PosCashDenominationRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Cash denominations are not configured for this store');
    return { success: true, cashDenominations: this.present(await this.withoutInlineImages(store.id, record)) };
  }

  async create(storeId: string, body: SavePosCashDenominationDto) {
    const store = await this.requireStore(storeId);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Cash denominations already exist for this store');
    }
    return { success: true, cashDenominations: await this.write(store.id, store.merchantId, body, null) };
  }

  async update(storeId: string, body: SavePosCashDenominationDto) {
    const store = await this.requireStore(storeId);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Cash denominations are not configured for this store');
    return { success: true, cashDenominations: await this.write(store.id, store.merchantId, body, current.id) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async withoutInlineImages(storeId: string, record: Record<string, any>) {
    if (!this.images.hasInlineImage(record)) return record;
    const prepared = await this.images.materialize(storeId, 'cash_denominations', record, false);
    if (!prepared.changed) return record;
    return savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'cash_denominations', prepared.value);
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'cash_denominations');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCashDenominationDto,
    _existingId: string | null,
  ): Promise<PosCashDenominationRecord> {
    const prepared = await this.images.materialize(storeId, 'cash_denominations', {
      merchantId,
      cashDenominations: this.itemRows(body.cashDenominations || []),
      coinDenominations: this.itemRows(body.coinDenominations || []),
    }, true);
    const saved = await savePosConfigDocument(
      this.merchants.requireDataSource(),
      storeId,
      'cash_denominations',
      prepared.value,
    );
    return this.present(saved);
  }

  private itemRows(list: PosCashDenominationItemDto[]) {
    return list.map(item => ({
      id: randomUUID(),
      amount: Number(item.amount),
      imageName: item.imageName.trim() || 'denomination',
      image: item.image || item.imageData,
    }));
  }

  private present(record: Record<string, any>): PosCashDenominationRecord {
    const mapItem = (item: Record<string, any>): PosCashDenominationItem => ({
      id: String(item.id),
      amount: Number(item.amount),
      imageName: item.imageName,
      imageData: String(item.image ?? item.imageData ?? ''),
    });
    const cash = Array.isArray(record.cashDenominations) ? record.cashDenominations : [];
    const coins = Array.isArray(record.coinDenominations) ? record.coinDenominations : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      cashDenominations: cash.map(mapItem),
      coinDenominations: coins.map(mapItem),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
