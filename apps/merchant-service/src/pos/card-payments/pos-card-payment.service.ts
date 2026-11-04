import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { readPosConfigDocument, savePosConfigDocument } from '../../modules/store-pos-configuration/store-pos-config-document';
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
    const document = await this.findDocument(store.id);
    return {
      success: true,
      cardPayments: this.providers(document).map(record => this.present(record, document || { storeId: store.id, merchantId: store.merchantId })),
    };
  }

  async create(storeId: string, body: SavePosCardPaymentDto) {
    const store = await this.requireStore(storeId);
    this.assertFields(body);
    const document = await this.findDocument(store.id);
    const providers = this.providers(document);
    if (providers.some(item => item.provider === body.provider)) {
      throw new ConflictException(`Card payment settings already exist for ${body.provider}`);
    }
    const saved = await this.write(store.id, store.merchantId, [...providers, { id: randomUUID(), ...this.fields(body) }]);
    const created = this.providers(saved).find(item => item.provider === body.provider);
    return { success: true, cardPayment: this.present(created, saved) };
  }

  async update(storeId: string, body: SavePosCardPaymentDto) {
    const store = await this.requireStore(storeId);
    this.assertFields(body);
    const document = await this.findDocument(store.id);
    const providers = this.providers(document);
    const current = providers.find(item => item.provider === body.provider);
    if (!current) throw new NotFoundException(`Card payment settings are not configured for ${body.provider}`);
    const next = providers.map(item => item.provider === body.provider ? { ...item, ...this.fields(body) } : item);
    const saved = await this.write(store.id, store.merchantId, next);
    const updated = this.providers(saved).find(item => item.provider === body.provider);
    return { success: true, cardPayment: this.present(updated, saved) };
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

  private async findDocument(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'card_payment_settings');
  }

  private providers(document: Record<string, any> | null): Array<Record<string, any>> {
    return Array.isArray(document?.providers) ? document.providers : [];
  }

  private async write(storeId: string, merchantId: string, providers: Array<Record<string, any>>) {
    return savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'card_payment_settings', {
      merchantId,
      providers,
    });
  }

  private fields(body: SavePosCardPaymentDto) {
    return {
      provider: body.provider,
      deviceId: body.deviceId.trim(),
      processorMerchantId: body.processorMerchantId.trim(),
      terminalId: body.provider === 'Payroc' ? (body.terminalId || '').trim() : '',
      secretKey: body.secretKey.trim(),
      webhookUrl: body.webhookUrl.trim(),
    };
  }

  private present(record: Record<string, any> | undefined, document: Record<string, any>): PosCardPaymentRecord {
    return {
      id: String(record?.id || ''),
      storeId: document.storeId,
      merchantId: document.merchantId,
      provider: record?.provider,
      deviceId: record?.deviceId,
      processorMerchantId: record?.processorMerchantId,
      terminalId: record?.terminalId || '',
      secretKey: record?.secretKey,
      webhookUrl: record?.webhookUrl,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
