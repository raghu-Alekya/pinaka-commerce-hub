import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, IsNull, Repository } from 'typeorm';
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

  private uniqueConflict(error: any, tendorCode: string, tendorName: string) {
    const detail = String(error?.detail || error?.driverError?.detail || '');
    const constraint = String(error?.constraint || error?.driverError?.constraint || '');
    const conflicts: string[] = [];
    if (constraint.includes('code') || detail.toLowerCase().includes('tendorcode')) {
      conflicts.push(`Tendor code '${tendorCode}' already exists`);
    }
    if (constraint.includes('name') || detail.toLowerCase().includes('tendorname')) {
      conflicts.push(`Tendor name '${tendorName}' already exists`);
    }
    if (!conflicts.length) {
      conflicts.push(`Tendor code '${tendorCode}' or name '${tendorName}' already exists`);
    }
    return new ConflictException({ message: conflicts, error: 'Conflict', statusCode: 409 });
  }

  private async findByNormalized(column: 'tendorCode' | 'tendorName', value: string, excludeId?: string) {
    const query = this.store()
      .createQueryBuilder('tendor')
      .where('tendor.deletedAt IS NULL')
      .andWhere(`LOWER(BTRIM(tendor.${column})) = LOWER(BTRIM(:value))`, { value });
    if (excludeId) query.andWhere('tendor.id != :excludeId', { excludeId });
    return query.getOne();
  }

  private async assertUniqueFields(tendorCode?: string, tendorName?: string, excludeId?: string) {
    const conflicts: string[] = [];
    if (tendorCode !== undefined) {
      const existing = await this.findByNormalized('tendorCode', tendorCode, excludeId);
      if (existing) conflicts.push(`Tendor code '${tendorCode}' already exists`);
    }
    if (tendorName !== undefined) {
      const existing = await this.findByNormalized('tendorName', tendorName, excludeId);
      if (existing) conflicts.push(`Tendor name '${tendorName}' already exists`);
    }
    if (conflicts.length) {
      throw new ConflictException({ message: conflicts, error: 'Conflict', statusCode: 409 });
    }
  }

  async list(query: { status?: string; search?: string } = {}): Promise<TendorEntity[]> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const search = ILike(`%${query.search.trim()}%`);
      return this.store().find({
        where: [
          { ...where, tendorName: search },
          { ...where, tendorCode: search },
        ],
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
    const tendorCode = dto.tendorCode.trim();
    const tendorName = dto.tendorName.trim();
    await this.assertUniqueFields(tendorCode, tendorName);
    const entity = this.store().create({
      tendorCode,
      tendorName,
      status: dto.status || TendorStatus.ACTIVE,
    });
    try {
      return await this.store().save(entity);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw this.uniqueConflict(error, tendorCode, tendorName);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTendorDto): Promise<TendorEntity> {
    if (dto.tendorCode === undefined && dto.tendorName === undefined && dto.status === undefined) {
      return this.getById(id);
    }
    const existing = await this.getById(id);
    const tendorCode = dto.tendorCode !== undefined ? dto.tendorCode.trim() : undefined;
    const tendorName = dto.tendorName !== undefined ? dto.tendorName.trim() : undefined;
    await this.assertUniqueFields(tendorCode, tendorName, existing.id);
    if (tendorCode !== undefined) existing.tendorCode = tendorCode;
    if (tendorName !== undefined) existing.tendorName = tendorName;
    if (dto.status !== undefined) existing.status = dto.status;
    try {
      return await this.store().save(existing);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw this.uniqueConflict(error, existing.tendorCode, existing.tendorName);
      }
      throw error;
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.getById(id);
    await this.store().softDelete({ id, deletedAt: IsNull() });
  }
}
