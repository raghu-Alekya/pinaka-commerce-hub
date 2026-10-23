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
import { SavePosCurrencyTaxDto } from './pos-currency-tax.dto';

export interface PosCurrencyTaxRecord {
  id: string;
  storeId: string;
  merchantId: string;
  currency: string;
  rounding: string;
  decimalPlaces: number;
  taxEnabled: boolean;
  defaultTaxRate: number | null;
  taxCalculation: string;
  taxClasses: Array<{ id: string; name: string; rate: number }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosCurrencyTaxService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; currencyTax: PosCurrencyTaxRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Currency and tax settings are not configured for this store');
    return { success: true, currencyTax: this.present(record) };
  }

  async create(storeId: string, body: SavePosCurrencyTaxDto) {
    const store = await this.requireStore(storeId);
    this.assertTaxClasses(body);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Currency and tax settings already exist for this store');
    }
    const saved = await this.write(store.id, store.merchantId, body, null);
    await this.merchants.updateStore(store.id, { currency: body.currency });
    return { success: true, currencyTax: saved };
  }

  async update(storeId: string, body: SavePosCurrencyTaxDto) {
    const store = await this.requireStore(storeId);
    this.assertTaxClasses(body);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Currency and tax settings are not configured for this store');
    const saved = await this.write(store.id, store.merchantId, body, current.id);
    await this.merchants.updateStore(store.id, { currency: body.currency });
    return { success: true, currencyTax: saved };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private assertTaxClasses(body: SavePosCurrencyTaxDto) {
    if (!body.taxEnabled) return;
    const blank = (body.taxClasses || []).some(item => !item.name?.trim());
    if (blank) throw new BadRequestException('Each tax class needs a name');
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'currency_taxes');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCurrencyTaxDto,
    _existingId: string | null,
  ): Promise<PosCurrencyTaxRecord> {
    const current = await this.findByStore(storeId);
    const namedClasses = (body.taxClasses || []).filter(item => item.name?.trim());
    const saved = await savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'currency_taxes', {
      ...(current || {}),
      merchantId,
      currency: body.currency,
      rounding: body.rounding,
      decimalPlaces: body.decimalPlaces,
      taxEnabled: body.taxEnabled,
      defaultTaxRate: body.taxEnabled ? Number(body.defaultTaxRate) : null,
      taxCalculation: body.taxCalculation,
      taxClasses: namedClasses.map(item => ({
        id: randomUUID(),
        name: item.name.trim(),
        rate: Number(item.rate),
      })),
    });
    return this.present(saved);
  }

  private present(record: Record<string, any>): PosCurrencyTaxRecord {
    const classes = Array.isArray(record.taxClasses) ? record.taxClasses : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      currency: record.currency,
      rounding: record.rounding,
      decimalPlaces: Number(record.decimalPlaces),
      taxEnabled: record.taxEnabled !== false,
      defaultTaxRate: record.defaultTaxRate === null || record.defaultTaxRate === undefined
        ? null
        : Number(record.defaultTaxRate),
      taxCalculation: record.taxCalculation,
      taxClasses: classes.map((item: Record<string, any>) => ({
        id: String(item.id),
        name: String(item.name),
        rate: Number(item.rate),
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
