import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant.repository';
import { PosCashbackEntity } from './pos-cashback.entity';
import { PosCashbackTierEntity } from './pos-cashback-tier.entity';
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
    return { success: true, cashback: await this.withTiers(record) };
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

  private repo() {
    return this.merchants.requireDataSource().getRepository(PosCashbackEntity);
  }

  private async findByStore(storeId: string) {
    return this.repo().findOne({ where: { storeId } });
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCashbackDto,
    existingId: string | null,
  ): Promise<PosCashbackRecord> {
    const db = this.merchants.requireDataSource();
    return db.transaction(async manager => {
      const settings = manager.getRepository(PosCashbackEntity);
      const tiers = manager.getRepository(PosCashbackTierEntity);
      const fields = {
        storeId,
        merchantId,
        enabled: body.enabled,
        maxCashback: body.maxCashback === undefined || body.maxCashback === null ? null : String(body.maxCashback),
      };
      const row = existingId
        ? await settings.save({ id: existingId, ...fields })
        : await settings.save(settings.create(fields));

      await tiers.delete({ cashbackId: row.id });
      const complete = (body.tiers || []).filter(item =>
        item.from !== undefined && item.to !== undefined && item.fee !== undefined &&
        !Number.isNaN(Number(item.from)) && !Number.isNaN(Number(item.to)) && !Number.isNaN(Number(item.fee)));
      const savedTiers = complete.length
        ? await tiers.save(complete.map((item, index) => tiers.create({
            cashbackId: row.id,
            fromAmount: String(item.from),
            toAmount: String(item.to),
            fee: String(item.fee),
            sortOrder: index,
          })))
        : [];

      return this.present(row, savedTiers);
    });
  }

  private async withTiers(record: PosCashbackEntity): Promise<PosCashbackRecord> {
    const tiers = await this.merchants.requireDataSource().getRepository(PosCashbackTierEntity).find({
      where: { cashbackId: record.id },
      order: { sortOrder: 'ASC' },
    });
    return this.present(record, tiers);
  }

  private present(record: PosCashbackEntity, tiers: PosCashbackTierEntity[]): PosCashbackRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      enabled: record.enabled,
      maxCashback: record.maxCashback === null || record.maxCashback === undefined ? null : Number(record.maxCashback),
      tiers: tiers.map(item => ({
        id: item.id,
        from: Number(item.fromAmount),
        to: Number(item.toAmount),
        fee: Number(item.fee),
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
