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
import { PosCashRegisterDto, SavePosCashRegisterDto } from './pos-cash-register.dto';

export interface PosCashRegisterItem {
  id: string;
  name: string;
  pos: string;
  maxCash: number;
  safeDrop: boolean;
  status: string;
}

export interface PosCashRegisterRecord {
  id: string;
  storeId: string;
  merchantId: string;
  registers: PosCashRegisterItem[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosCashRegisterService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; cashRegister: PosCashRegisterRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Cash register settings are not configured for this store');
    return { success: true, cashRegister: this.present(record) };
  }

  async create(storeId: string, body: SavePosCashRegisterDto) {
    const store = await this.requireStore(storeId);
    this.assertUnique(body.registers || []);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Cash register settings already exist for this store');
    }
    return { success: true, cashRegister: await this.write(store.id, store.merchantId, body, null) };
  }

  async update(storeId: string, body: SavePosCashRegisterDto) {
    const store = await this.requireStore(storeId);
    this.assertUnique(body.registers || []);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Cash register settings are not configured for this store');
    return { success: true, cashRegister: await this.write(store.id, store.merchantId, body, current.id) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private assertUnique(registers: PosCashRegisterDto[]) {
    const names = new Set<string>();
    const devices = new Set<string>();
    for (const register of registers) {
      const name = register.name.trim().toLowerCase();
      const pos = register.pos.trim().toLowerCase();
      if (!name || !pos) throw new BadRequestException('Each register needs a name and an assigned POS');
      if (names.has(name) || devices.has(pos)) {
        throw new BadRequestException('Register names and assigned POS devices must be unique');
      }
      names.add(name);
      devices.add(pos);
    }
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'cash_register_settings');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCashRegisterDto,
    _existingId: string | null,
  ): Promise<PosCashRegisterRecord> {
    const saved = await savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'cash_register_settings', {
      merchantId,
      registers: (body.registers || []).map(item => ({
        id: item.id || randomUUID(),
        name: item.name.trim(),
        pos: item.pos.trim(),
        maxCash: Number(item.maxCash),
        safeDrop: item.safeDrop,
        status: item.status,
      })),
    });
    return this.present(saved);
  }

  private present(record: Record<string, any>): PosCashRegisterRecord {
    const registers = Array.isArray(record.registers) ? record.registers : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      registers: registers.map((item: Record<string, any>) => ({
        id: String(item.id),
        name: item.name,
        pos: item.pos,
        maxCash: Number(item.maxCash),
        safeDrop: Boolean(item.safeDrop),
        status: item.status,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
