import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { PosOpeningBalanceEntity } from './entities/pos-opening-balance.entity';
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
    const saved = await this.repo().save(this.repo().create(this.fields(store.id, store.merchantId, body)));
    return { success: true, openingBalance: this.present(saved) };
  }

  async update(storeId: string, body: SavePosOpeningBalanceDto) {
    const store = await this.requireStore(storeId);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Opening balance settings are not configured for this store');
    const saved = await this.repo().save({ id: current.id, ...this.fields(store.id, store.merchantId, body) });
    return { success: true, openingBalance: this.present(saved) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private repo() {
    return this.merchants.requireDataSource().getRepository(PosOpeningBalanceEntity);
  }

  private async findByStore(storeId: string) {
    return this.repo().findOne({ where: { storeId } });
  }

  private fields(storeId: string, merchantId: string, body: SavePosOpeningBalanceDto) {
    return {
      storeId,
      merchantId,
      requireOpeningBalance: body.requireOpeningBalance,
      defaultOpeningAmount: String(body.defaultOpeningAmount),
      managerApprovalRequired: body.managerApprovalRequired,
      varianceTolerance: String(body.varianceTolerance),
      allowCashierOverride: body.allowCashierOverride,
      countByDenomination: body.countByDenomination,
    };
  }

  private present(record: PosOpeningBalanceEntity): PosOpeningBalanceRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      requireOpeningBalance: record.requireOpeningBalance,
      defaultOpeningAmount: Number(record.defaultOpeningAmount),
      managerApprovalRequired: record.managerApprovalRequired,
      varianceTolerance: Number(record.varianceTolerance),
      allowCashierOverride: record.allowCashierOverride,
      countByDenomination: record.countByDenomination,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
