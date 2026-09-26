import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRepository } from '../../merchant.repository';
import { PosCardPaymentEntity } from './pos-card-payment.entity';
import { SavePosCardPaymentDto } from './pos-card-payment.dto';

export interface PosCardPaymentRecord {
  id: string;
  storeId: string;
  merchantId: string;
  provider: string;
  deviceId: string;
  processorMerchantId: string;
  terminalId: string;
  secretKey: string;
  webhookUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosCardPaymentService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; cardPayments: PosCardPaymentRecord[] }> {
    const store = await this.requireStore(storeId);
    const records = await this.repo().find({ where: { storeId: store.id }, order: { provider: 'ASC' } });
    return { success: true, cardPayments: records.map(record => this.present(record)) };
  }

  async create(storeId: string, body: SavePosCardPaymentDto) {
    const store = await this.requireStore(storeId);
    this.assertFields(body);
    if (await this.findByStoreAndProvider(store.id, body.provider)) {
      throw new ConflictException(`Card payment settings already exist for ${body.provider}`);
    }
    const saved = await this.repo().save(this.repo().create(this.fields(store.id, store.merchantId, body)));
    return { success: true, cardPayment: this.present(saved) };
  }

  async update(storeId: string, body: SavePosCardPaymentDto) {
    const store = await this.requireStore(storeId);
    this.assertFields(body);
    const current = await this.findByStoreAndProvider(store.id, body.provider);
    if (!current) throw new NotFoundException(`Card payment settings are not configured for ${body.provider}`);
    const saved = await this.repo().save({ id: current.id, ...this.fields(store.id, store.merchantId, body) });
    return { success: true, cardPayment: this.present(saved) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private assertFields(body: SavePosCardPaymentDto) {
    if (!body.deviceId?.trim() || !body.processorMerchantId?.trim() || !body.secretKey?.trim() || !body.webhookUrl?.trim()) {
      throw new BadRequestException('Device ID, processor merchant ID, secret key, and webhook URL are required');
    }
    if (body.provider === 'Payroc' && !body.terminalId?.trim()) {
      throw new BadRequestException('Terminal ID is required for Payroc');
    }
  }

  private repo() {
    return this.merchants.requireDataSource().getRepository(PosCardPaymentEntity);
  }

  private async findByStoreAndProvider(storeId: string, provider: string) {
    return this.repo().findOne({ where: { storeId, provider } });
  }

  private fields(storeId: string, merchantId: string, body: SavePosCardPaymentDto) {
    return {
      storeId,
      merchantId,
      provider: body.provider,
      deviceId: body.deviceId.trim(),
      processorMerchantId: body.processorMerchantId.trim(),
      terminalId: body.provider === 'Payroc' ? (body.terminalId || '').trim() : '',
      secretKey: body.secretKey.trim(),
      webhookUrl: body.webhookUrl.trim(),
    };
  }

  private present(record: PosCardPaymentEntity): PosCardPaymentRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      provider: record.provider,
      deviceId: record.deviceId,
      processorMerchantId: record.processorMerchantId,
      terminalId: record.terminalId,
      secretKey: record.secretKey,
      webhookUrl: record.webhookUrl,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
