import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { readPosConfigDocument, savePosConfigDocument } from '../../modules/store-pos-configuration/store-pos-config-document';
import { SavePosOpeningBalanceDto } from './pos-opening-balance.dto';

export interface PosOpeningBalanceRecord {
  id: string;
  storeId: string;
  merchantId: string;
  requireOpeningBalance: boolean;
  defaultOpeningAmount: number;
  managerApprovalRequired: boolean;
  varianceTolerance: number;
  allowCashierOverride: boolean;
  countByDenomination: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosOpeningBalanceService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; openingBalance: PosOpeningBalanceRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Opening balance settings are not configured for this store');
    return { success: true, openingBalance: this.present(record) };
  }

  async create(storeId: string, body: SavePosOpeningBalanceDto) {
    const store = await this.requireStore(storeId);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Opening balance settings already exist for this store');
    }
    const saved = await savePosConfigDocument(
      this.merchants.requireDataSource(),
      store.id,
      'opening_balance',
      this.fields(store.merchantId, body),
    );
    return { success: true, openingBalance: this.present(saved) };
  }

  async update(storeId: string, body: SavePosOpeningBalanceDto) {
    const store = await this.requireStore(storeId);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Opening balance settings are not configured for this store');
    const saved = await savePosConfigDocument(
      this.merchants.requireDataSource(),
      store.id,
      'opening_balance',
      this.fields(store.merchantId, body),
    );
    return { success: true, openingBalance: this.present(saved) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'opening_balance');
  }

  private fields(merchantId: string, body: SavePosOpeningBalanceDto) {
    return {
      merchantId,
      requireOpeningBalance: body.requireOpeningBalance,
      defaultOpeningAmount: Number(body.defaultOpeningAmount),
      managerApprovalRequired: body.managerApprovalRequired,
      varianceTolerance: Number(body.varianceTolerance),
      allowCashierOverride: body.allowCashierOverride,
      countByDenomination: body.countByDenomination,
    };
  }

  private present(record: Record<string, any>): PosOpeningBalanceRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      requireOpeningBalance: Boolean(record.requireOpeningBalance),
      defaultOpeningAmount: Number(record.defaultOpeningAmount),
      managerApprovalRequired: Boolean(record.managerApprovalRequired),
      varianceTolerance: Number(record.varianceTolerance),
      allowCashierOverride: Boolean(record.allowCashierOverride),
      countByDenomination: Boolean(record.countByDenomination),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
