import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MerchantRepository } from '../../merchant.repository';
import { PosCashRegisterSettingsEntity } from './pos-cash-register-settings.entity';
import { PosCashRegisterEntity } from './pos-cash-register.entity';
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
    return { success: true, cashRegister: await this.withRegisters(record) };
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

  private settingsRepo() {
    return this.merchants.requireDataSource().getRepository(PosCashRegisterSettingsEntity);
  }

  private async findByStore(storeId: string) {
    return this.settingsRepo().findOne({ where: { storeId } });
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosCashRegisterDto,
    existingId: string | null,
  ): Promise<PosCashRegisterRecord> {
    const db = this.merchants.requireDataSource();
    return db.transaction(async manager => {
      const settings = manager.getRepository(PosCashRegisterSettingsEntity);
      const registers = manager.getRepository(PosCashRegisterEntity);
      const row = existingId
        ? await settings.save({ id: existingId, storeId, merchantId })
        : await settings.save(settings.create({ storeId, merchantId }));

      await registers.delete({ registerSettingsId: row.id });
      const saved = (body.registers || []).length
        ? await registers.save((body.registers || []).map((item, index) => registers.create({
            ...(item.id ? { id: item.id } : {}),
            registerSettingsId: row.id,
            name: item.name.trim(),
            pos: item.pos.trim(),
            maxCash: String(item.maxCash),
            safeDrop: item.safeDrop,
            status: item.status,
            sortOrder: index,
          })))
        : [];
      return this.present(row, saved);
    });
  }

  private async withRegisters(record: PosCashRegisterSettingsEntity): Promise<PosCashRegisterRecord> {
    const registers = await this.merchants.requireDataSource().getRepository(PosCashRegisterEntity).find({
      where: { registerSettingsId: record.id },
      order: { sortOrder: 'ASC' },
    });
    return this.present(record, registers);
  }

  private present(record: PosCashRegisterSettingsEntity, registers: PosCashRegisterEntity[]): PosCashRegisterRecord {
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      registers: registers.map(item => ({
        id: item.id,
        name: item.name,
        pos: item.pos,
        maxCash: Number(item.maxCash),
        safeDrop: item.safeDrop,
        status: item.status,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
