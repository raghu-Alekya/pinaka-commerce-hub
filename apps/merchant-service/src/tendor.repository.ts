import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, IsNull, Not, Repository } from 'typeorm';
import { MerchantRepository } from './merchant.repository';
import { TendorEntity, TendorStatus } from './entities/tendor.entity';
import { CreateTendorDto, UpdateTendorDto } from './tendor.dto';

@Injectable()
export class TendorRepository {
  private repo?: Repository<TendorEntity>;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private store() {
    this.repo ??= this.merchants.requireDataSource().getRepository(TendorEntity);
    return this.repo;
  }

  private async assertUniqueName(tendorName: string, excludeId?: string) {
    const existing = await this.store().findOne({
      where: excludeId
        ? { tendorName: ILike(tendorName), id: Not(excludeId) }
        : { tendorName: ILike(tendorName) },
    });
    if (existing) throw new ConflictException(`Tendor name '${tendorName}' already exists`);
  }

  async list(query: { status?: string; search?: string } = {}): Promise<TendorEntity[]> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      return this.store().find({
        where: { ...where, tendorName: ILike(`%${query.search.trim()}%`) },
        order: { tendorName: 'ASC', id: 'ASC' },
      });
    }
    return this.store().find({ where, order: { tendorName: 'ASC', id: 'ASC' } });
  }

  async getById(id: string): Promise<TendorEntity> {
    const tendor = await this.store().findOne({ where: { id } });
    if (!tendor) throw new NotFoundException(`Tendor '${id}' not found`);
    return tendor;
  }

  async create(dto: CreateTendorDto): Promise<TendorEntity> {
    const tendorName = dto.tendorName.trim();
    await this.assertUniqueName(tendorName);
    const entity = this.store().create({
      tendorName,
      status: dto.status || TendorStatus.ACTIVE,
    });
    try {
      return await this.store().save(entity);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException(`Tendor name '${tendorName}' already exists`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTendorDto): Promise<TendorEntity> {
    if (dto.tendorName === undefined && dto.status === undefined) {
      return this.getById(id);
    }
    const existing = await this.getById(id);
    if (dto.tendorName !== undefined) {
      const tendorName = dto.tendorName.trim();
      await this.assertUniqueName(tendorName, existing.id);
      existing.tendorName = tendorName;
    }
    if (dto.status !== undefined) existing.status = dto.status;
    try {
      return await this.store().save(existing);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException(`Tendor name '${existing.tendorName}' already exists`);
      }
      throw error;
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.getById(id);
    await this.store().softDelete({ id, deletedAt: IsNull() });
  }
}
