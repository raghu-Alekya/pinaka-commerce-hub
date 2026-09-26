import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant.repository';
import { PosServiceChargeEntity } from './pos-service-charge.entity';
import { PosServiceChargeTierEntity } from './pos-service-charge-tier.entity';
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
    return { success: true, serviceCharge: await this.withTiers(record) };
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

  private repo() {
    return this.merchants.requireDataSource().getRepository(PosServiceChargeEntity);
  }

  private async findByStore(storeId: string) {
    return this.repo().findOne({ where: { storeId } });
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosServiceChargeDto,
    existingId: string | null,
  ): Promise<PosServiceChargeRecord> {
    const db = this.merchants.requireDataSource();
    return db.transaction(async manager => {
      const settings = manager.getRepository(PosServiceChargeEntity);
      const tiers = manager.getRepository(PosServiceChargeTierEntity);
      const fields = {
        storeId,
        merchantId,
        enabled: body.enabled,
        applyTo: body.applyTo,
        defaultType: body.defaultType,
        maxLimit: String(body.maxLimit),
      };
      const row = existingId
        ? await settings.save({ id: existingId, ...fields })
        : await settings.save(settings.create(fields));

      await tiers.delete({ serviceChargeId: row.id });
      const complete = (body.tiers || []).filter(item => item.from?.trim() && item.to?.trim() && item.fee?.trim());
      const savedTiers = complete.length
        ? await tiers.save(complete.map((item, index) => tiers.create({
            serviceChargeId: row.id,
            fromAmount: item.from.trim(),
            toAmount: item.to.trim(),
            fee: item.fee.trim(),
            feeType: item.feeType,
            appliesTo: item.appliesTo,
            sortOrder: index,
          })))
        : [];

      return this.present(row, savedTiers);
    });
  }

  private async withTiers(record: PosServiceChargeEntity): Promise<PosServiceChargeRecord> {
    const tiers = await this.merchants.requireDataSource().getRepository(PosServiceChargeTierEntity).find({
      where: { serviceChargeId: record.id },
      order: { sortOrder: 'ASC' },
    });
    return this.present(record, tiers);
  }

  private present(record: PosServiceChargeEntity, tiers: PosServiceChargeTierEntity[]): PosServiceChargeRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      enabled: record.enabled,
      applyTo: record.applyTo,
      defaultType: record.defaultType,
      maxLimit: Number(record.maxLimit),
      tiers: tiers.map(item => ({
        id: item.id,
        from: item.fromAmount,
        to: item.toAmount,
        fee: item.fee,
        feeType: item.feeType,
        appliesTo: item.appliesTo,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
