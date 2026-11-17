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
import { PosTerminalMappingDto, SavePosTerminalMappingDto } from './pos-terminal-mapping.dto';

export interface PosTerminalMappingItem {
  id: string;
  registerId: string;
  terminal: string;
  printer: string;
  drawer: string;
  status: string;
}

export interface PosTerminalMappingRecord {
  id: string;
  storeId: string;
  merchantId: string;
  mappings: PosTerminalMappingItem[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PosTerminalMappingService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async get(storeId: string): Promise<{ success: true; terminalMapping: PosTerminalMappingRecord }> {
    const store = await this.requireStore(storeId);
    const record = await this.findByStore(store.id);
    if (!record) throw new NotFoundException('Terminal mappings are not configured for this store');
    return { success: true, terminalMapping: this.present(record) };
  }

  async create(storeId: string, body: SavePosTerminalMappingDto) {
    const store = await this.requireStore(storeId);
    await this.assertMappings(store.id, body.mappings || []);
    if (await this.findByStore(store.id)) {
      throw new ConflictException('Terminal mappings already exist for this store');
    }
    return { success: true, terminalMapping: await this.write(store.id, store.merchantId, body, null) };
  }

  async update(storeId: string, body: SavePosTerminalMappingDto) {
    const store = await this.requireStore(storeId);
    await this.assertMappings(store.id, body.mappings || []);
    const current = await this.findByStore(store.id);
    if (!current) throw new NotFoundException('Terminal mappings are not configured for this store');
    return { success: true, terminalMapping: await this.write(store.id, store.merchantId, body, current.id) };
  }

  private async requireStore(storeId: string) {
    const store = await this.merchants.getStoreById(storeId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async assertMappings(storeId: string, mappings: PosTerminalMappingDto[]) {
    const registers = new Set<string>();
    const terminals = new Set<string>();
    const drawers = new Set<string>();
    for (const mapping of mappings) {
      if (registers.has(mapping.registerId)) {
        throw new BadRequestException('A register cannot be assigned to more than one mapping');
      }
      registers.add(mapping.registerId);
      const terminal = mapping.terminal.trim().toLowerCase();
      const drawer = mapping.drawer.trim().toLowerCase();
      if (terminal && terminals.has(terminal)) {
        throw new BadRequestException('A card terminal cannot be assigned to more than one mapping');
      }
      if (drawer && drawers.has(drawer)) {
        throw new BadRequestException('A cash drawer cannot be assigned to more than one mapping');
      }
      if (terminal) terminals.add(terminal);
      if (drawer) drawers.add(drawer);
    }
    if (!mappings.length) return;
    const registerSettings = await readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'cash_register_settings');
    const rows = Array.isArray(registerSettings?.registers) ? registerSettings.registers : [];
    const byId = new Map(rows.map((row: { id: string; status: string }) => [String(row.id), row.status]));
    for (const mapping of mappings) {
      const status = byId.get(mapping.registerId);
      if (!status) throw new BadRequestException('Choose a register saved in Cash Register Settings');
      if (mapping.status === 'Active' && (status !== 'Active' || !mapping.terminal.trim() || !mapping.printer.trim() || !mapping.drawer.trim())) {
        throw new BadRequestException('Active mappings require an active register, card terminal, printer and cash drawer');
      }
    }
  }

  private async findByStore(storeId: string) {
    return readPosConfigDocument(this.merchants.requireDataSource(), storeId, 'terminal_register_mapping');
  }

  private async write(
    storeId: string,
    merchantId: string,
    body: SavePosTerminalMappingDto,
    _existingId: string | null,
  ): Promise<PosTerminalMappingRecord> {
    const saved = await savePosConfigDocument(this.merchants.requireDataSource(), storeId, 'terminal_register_mapping', {
      merchantId,
      mappings: (body.mappings || []).map(item => ({
        id: item.id || randomUUID(),
        registerId: item.registerId,
        terminal: item.terminal.trim(),
        printer: item.printer.trim(),
        drawer: item.drawer.trim(),
        status: item.status,
      })),
    });
    return this.present(saved);
  }

  private present(record: Record<string, any>): PosTerminalMappingRecord {
    const mappings = Array.isArray(record.mappings) ? record.mappings : [];
    return {
      id: record.id,
      storeId: record.storeId,
      merchantId: record.merchantId,
      mappings: mappings.map((item: Record<string, any>) => ({
        id: String(item.id),
        registerId: String(item.registerId),
        terminal: item.terminal,
        printer: item.printer,
        drawer: item.drawer,
        status: item.status,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
