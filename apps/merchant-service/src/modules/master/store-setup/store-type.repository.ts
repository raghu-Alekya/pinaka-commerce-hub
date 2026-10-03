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
    return repository.find({
      where: {
        ...(status
          ? { status: status.toUpperCase() as StoreTypeStatus }
          : {}),
        isDeleted: false,
      },
      order: { name: 'ASC' },
    });
  }

  async previewNextCode(): Promise<string> {
    const rows = await this.merchants.requireDataSource().query(
      `SELECT last_value, is_called FROM public.store_type_code_seq`,
    );
    const sequence = rows[0] as
      | { last_value?: string | number; is_called?: boolean }
      | undefined;
    const lastValue = Number(sequence?.last_value || 1);
    const nextValue = sequence?.is_called ? lastValue + 1 : lastValue;
    return `STT_${String(nextValue).padStart(5, '0')}`;
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
      const byId = await repository.findOneBy({ id: value, isDeleted: false });
      if (byId) return byId;
    }
    return repository.findOneBy({
      storeTypeCode: value.toUpperCase(),
      isDeleted: false,
    });
  }

  async findByName(name: string): Promise<StoreTypeEntity | null> {
    if (!name?.trim()) return null;
    return this.repository()
      .createQueryBuilder('storeType')
      .where('LOWER(TRIM(storeType.name)) = LOWER(TRIM(:name))', { name })
      .andWhere('storeType.isDeleted = false')
      .getOne();
  }

  async create(
    dto: CreateStoreTypeDto,
    loginUserId: string,
  ): Promise<StoreTypeEntity> {
    const duplicate = await this.findByName(dto.name);
    if (duplicate) {
      throw new ConflictException(
        `Store type name '${dto.name.trim()}' already exists`,
      );
    }
    const repository = this.repository();
    const entity = repository.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      status: dto.status || StoreTypeStatus.ACTIVE,
      createdBy: loginUserId,
      updatedBy: null,
    });
    const saved = await repository.save(entity);
    return (await repository.findOneBy({ id: saved.id })) || saved;
  }

  async update(
    idOrCode: string,
    dto: UpdateStoreTypeDto,
    loginUserId: string,
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
    existing.updatedBy = loginUserId;
    existing.updatedAt = new Date();
    return this.repository().save(existing);
  }

  async softDelete(idOrCode: string, loginUserId: string): Promise<boolean> {
    const existing = await this.findByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.isDeleted = true;
    existing.updatedBy = loginUserId;
    existing.updatedAt = new Date();
    await this.repository().save(existing);
    return true;
  }
}
