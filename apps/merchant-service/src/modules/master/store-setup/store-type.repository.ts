import {
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  StoreTypeEntity,
  StoreTypeStatus,
} from '../../../entities/store-type.entity';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { CreateStoreTypeDto, UpdateStoreTypeDto } from './store-type.dto';

@Injectable()
export class StoreTypeRepository {
  constructor(
    @Inject(MerchantRepository)
    private readonly merchants: MerchantRepository,
  ) {}

  private repository(): Repository<StoreTypeEntity> {
    return this.merchants
      .requireDataSource()
      .getRepository(StoreTypeEntity);
  }

  async list(status?: string): Promise<StoreTypeEntity[]> {
    const repository = this.repository();
    let qb = repository.createQueryBuilder('st')
      .where('(st.isDeleted = false OR st.isDeleted IS NULL)');
    if (status) {
      qb = qb.andWhere('UPPER(st.status) = UPPER(:status)', { status });
    }
    const items = await qb.orderBy('st.name', 'ASC').getMany();
    if (items.length === 0) {
      try {
        await this.seedDefaultStoreTypes();
        return await repository.createQueryBuilder('st')
          .where('(st.isDeleted = false OR st.isDeleted IS NULL)')
          .orderBy('st.name', 'ASC')
          .getMany();
      } catch {
        // ignore seed error
      }
    }
    return items;
  }

  async seedDefaultStoreTypes(): Promise<void> {
    const count = await this.repository().count();
    if (count > 0) return;
    const defaults = [
      { code: 'ST-001', name: 'Retail Store', description: 'General retail and merchandise sales' },
      { code: 'ST-002', name: 'Restaurant & Dining', description: 'Food service, dine-in and takeaway' },
      { code: 'ST-003', name: 'Grocery & Supermarket', description: 'Groceries, fresh produce, and essentials' },
      { code: 'ST-004', name: 'Convenience Store', description: 'Quick-stop retail goods and packaged foods' },
      { code: 'ST-005', name: 'Fashion & Apparel', description: 'Clothing, footwear, and accessories' },
      { code: 'ST-006', name: 'Electronics & Gadgets', description: 'Consumer electronics and accessories' },
      { code: 'ST-007', name: 'Pharmacy & Healthcare', description: 'Medicines, health, and personal care' },
    ];
    for (const d of defaults) {
      try {
        await this.merchants.requireDataSource().query(
          `INSERT INTO public.store_types (store_type_code, name, description, status)
           VALUES ($1, $2, $3, 'ACTIVE')
           ON CONFLICT (store_type_code) DO NOTHING`,
          [d.code, d.name, d.description],
        );
      } catch {
        // ignore
      }
    }
  }

  async previewNextCode(): Promise<string> {
    try {
      const rows = await this.merchants.requireDataSource().query(
        `SELECT last_value, is_called FROM public.store_type_code_seq`,
      );
      const sequence = rows[0] as
        | { last_value?: string | number; is_called?: boolean }
        | undefined;
      const lastValue = Number(sequence?.last_value || 1);
      const nextValue = sequence?.is_called ? lastValue + 1 : lastValue;
      return `STT_${String(nextValue).padStart(5, '0')}`;
    } catch {
      try {
        const count = await this.repository().count();
        return `ST-${String(count + 1).padStart(3, '0')}`;
      } catch {
        return `ST-001`;
      }
    }
  }

  async findByIdOrCode(idOrCode: string): Promise<StoreTypeEntity | null> {
    if (!idOrCode?.trim()) return null;
    const repository = this.repository();
    const value = idOrCode.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      );
    if (isUuid) {
      const byId = await repository.createQueryBuilder('st')
        .where('st.id = :id AND (st.isDeleted = false OR st.isDeleted IS NULL)', { id: value })
        .getOne();
      if (byId) return byId;
    }
    return repository.createQueryBuilder('st')
      .where('(UPPER(st.storeTypeCode) = UPPER(:code) OR UPPER(st.name) = UPPER(:code)) AND (st.isDeleted = false OR st.isDeleted IS NULL)', { code: value })
      .getOne();
  }

  async findByName(name: string): Promise<StoreTypeEntity | null> {
    if (!name?.trim()) return null;
    return this.repository()
      .createQueryBuilder('storeType')
      .where('LOWER(TRIM(storeType.name)) = LOWER(TRIM(:name))', { name })
      .andWhere('(storeType.isDeleted = false OR storeType.isDeleted IS NULL)')
      .getOne();
  }

  async create(
    dto: CreateStoreTypeDto,
    loginUserId?: string | null,
  ): Promise<StoreTypeEntity> {
    const duplicate = await this.findByName(dto.name);
    if (duplicate) {
      throw new ConflictException(
        `Store type name '${dto.name.trim()}' already exists`,
      );
    }
    const repository = this.repository();
    const code = (dto as any).code || (dto as any).storeTypeCode || (await this.previewNextCode());
    const entity = repository.create({
      storeTypeCode: code,
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      status: dto.status || StoreTypeStatus.ACTIVE,
      createdBy: loginUserId || null,
      updatedBy: null,
    });
    const saved = await repository.save(entity);
    return (await this.findByIdOrCode(saved.id)) || saved;
  }

  async update(
    idOrCode: string,
    dto: UpdateStoreTypeDto,
    loginUserId?: string | null,
  ): Promise<StoreTypeEntity | null> {
    const existing = await this.findByIdOrCode(idOrCode);
    if (!existing) return null;
    if (dto.name !== undefined) {
      const duplicate = await this.findByName(dto.name);
      if (duplicate && duplicate.id !== existing.id) {
        throw new ConflictException(
          `Store type name '${dto.name.trim()}' already exists`,
        );
      }
      existing.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      existing.description = dto.description.trim();
    }
    if (dto.status !== undefined) existing.status = dto.status;
    existing.updatedBy = loginUserId || null;
    existing.updatedAt = new Date();
    return this.repository().save(existing);
  }

  async softDelete(idOrCode: string, loginUserId?: string | null): Promise<boolean> {
    const existing = await this.findByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.isDeleted = true;
    existing.updatedBy = loginUserId || null;
    existing.updatedAt = new Date();
    await this.repository().save(existing);
    return true;
  }
}
