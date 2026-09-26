import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant.repository';
import { PosCurrencyTaxEntity } from './pos-currency-tax.entity';
import { PosTaxClassEntity } from './pos-tax-class.entity';
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
    return { success: true, currencyTax: await this.withClasses(record) };
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

  private repo() {
    return this.merchants.requireDataSource().getRepository(PosCurrencyTaxEntity);
  }

  private async findByStore(storeId: string) {
    return this.repo().findOne({ where: { storeId } });
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCurrencyTaxDto,
    existingId: string | null,
  ): Promise<PosCurrencyTaxRecord> {
    const db = this.merchants.requireDataSource();
    return db.transaction(async manager => {
      const settings = manager.getRepository(PosCurrencyTaxEntity);
      const classes = manager.getRepository(PosTaxClassEntity);
      const row = existingId
        ? await settings.save({
            id: existingId,
            storeId,
            merchantId,
            currency: body.currency,
            rounding: body.rounding,
            decimalPlaces: body.decimalPlaces,
            taxEnabled: body.taxEnabled,
            defaultTaxRate: body.taxEnabled ? String(body.defaultTaxRate) : null,
            taxCalculation: body.taxCalculation,
          })
        : await settings.save(settings.create({
            storeId,
            merchantId,
            currency: body.currency,
            rounding: body.rounding,
            decimalPlaces: body.decimalPlaces,
            taxEnabled: body.taxEnabled,
            defaultTaxRate: body.taxEnabled ? String(body.defaultTaxRate) : null,
            taxCalculation: body.taxCalculation,
          }));

      await classes.delete({ currencyTaxId: row.id });
      const namedClasses = (body.taxClasses || []).filter(item => item.name?.trim());
      const taxClasses = namedClasses.length
        ? await classes.save(namedClasses.map((item, index) => classes.create({
            currencyTaxId: row.id,
            name: item.name.trim(),
            rate: String(item.rate),
            sortOrder: index,
          })))
        : [];

      return this.present(row, taxClasses);
    });
  }

  private async withClasses(record: PosCurrencyTaxEntity): Promise<PosCurrencyTaxRecord> {
    const classes = await this.merchants.requireDataSource().getRepository(PosTaxClassEntity).find({
      where: { currencyTaxId: record.id },
      order: { sortOrder: 'ASC' },
    });
    return this.present(record, classes);
  }

  private present(record: PosCurrencyTaxEntity, classes: PosTaxClassEntity[]): PosCurrencyTaxRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      currency: record.currency,
      rounding: record.rounding,
      decimalPlaces: Number(record.decimalPlaces),
      taxEnabled: record.taxEnabled,
      defaultTaxRate: record.defaultTaxRate === null || record.defaultTaxRate === undefined
        ? null
        : Number(record.defaultTaxRate),
      taxCalculation: record.taxCalculation,
      taxClasses: classes.map(item => ({
        id: item.id,
        name: item.name,
        rate: Number(item.rate),
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
