import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ILike, Repository } from 'typeorm';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { TendorEntity, TendorStatus } from '../../../entities/tendor.entity';
import { CreateTendorDto, UpdateTendorDto } from './tendor.dto';


const normalizeText = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeStatus = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.toUpperCase();
};

@Injectable()
export class TendorRepository {
  private repo?: Repository<TendorEntity>;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private store() {
    this.repo ??= this.merchants.requireDataSource().getRepository(TendorEntity);
    return this.repo;
  }

  private requireText(value: string | undefined, field: string): string {
    const normalized = normalizeText(value);
    if (!normalized) throw new BadRequestException(`${field} is required`);
    return normalized;
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
    const normalized = normalizeText(value);
    if (!normalized) return null;

    const query = this.store()
      .createQueryBuilder('tendor')
      .where('tendor.isDeleted = false')
      .andWhere(`LOWER(BTRIM(tendor.${column})) = LOWER(BTRIM(:value))`, { value: normalized });
    if (excludeId) query.andWhere('tendor.id != :excludeId', { excludeId });
    return query.getOne();
  }

  private async assertUniqueFields(tendorCode?: string, tendorName?: string, excludeId?: string) {
    const conflicts: string[] = [];
    if (tendorCode !== undefined) {
      const normalizedCode = this.requireText(tendorCode, 'tendorCode');
      const existing = await this.findByNormalized('tendorCode', normalizedCode, excludeId);
      if (existing) conflicts.push(`Tendor code '${normalizedCode}' already exists`);
    }
    if (tendorName !== undefined) {
      const normalizedName = this.requireText(tendorName, 'tendorName');
      const existing = await this.findByNormalized('tendorName', normalizedName, excludeId);
      if (existing) conflicts.push(`Tendor name '${normalizedName}' already exists`);
    }
    if (conflicts.length) {
      throw new ConflictException({ message: conflicts, error: 'Conflict', statusCode: 409 });
    }
  }

  private async requireMerchantUuid(merchantId: string): Promise<string> {
    const uuid = await this.merchants.resolveMerchantUuid(merchantId);
    if (!uuid) throw new NotFoundException(`Merchant '${merchantId}' not found`);
    return uuid;
  }

  async listMerchantTendors(merchantId: string, query: { search?: string; status?: string } = {}): Promise<any[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const status = normalizeStatus(query.status);
    const params: unknown[] = [merchantUuid];
    let sql = `
      SELECT t.*, mt.status AS "assignmentStatus", mt.id AS "assignmentId", true AS assigned
      FROM public.merchant_tendors mt
      JOIN public.tendors t ON t.id = mt.tendor_id
      WHERE mt.merchant_id = $1 AND mt.status = 'ACTIVE' AND t.is_deleted = FALSE
    `;
    if (status) {
      params.push(status);
      sql += ` AND t.status = $${params.length}`;
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const i = params.length;
      sql += ` AND (t.tendor_name ILIKE $${i} OR t.tendor_code ILIKE $${i})`;
    }
    sql += ` ORDER BY t.tendor_name ASC, t.id ASC`;
    return this.merchants.requireDataSource().query(sql, params);
  }

  async listAllTendorsWithAssignment(
    merchantId: string,
    query: { search?: string; status?: string } = {},
  ): Promise<any[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const status = normalizeStatus(query.status);
    const params: unknown[] = [merchantUuid];
    let sql = `
      SELECT t.*,
             CASE WHEN mt.id IS NOT NULL AND mt.status = 'ACTIVE' THEN true ELSE false END AS assigned,
             mt.status AS "assignmentStatus", mt.id AS "assignmentId"
      FROM public.tendors t
      LEFT JOIN public.merchant_tendors mt ON mt.tendor_id = t.id AND mt.merchant_id = $1
      WHERE t.is_deleted = FALSE
    `;
    if (status) {
      params.push(status);
      sql += ` AND t.status = $${params.length}`;
    } else {
      sql += ` AND t.status = 'ACTIVE'`;
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const i = params.length;
      sql += ` AND (t.tendor_name ILIKE $${i} OR t.tendor_code ILIKE $${i})`;
    }
    sql += ` ORDER BY assigned DESC, t.tendor_name ASC, t.id ASC`;
    return this.merchants.requireDataSource().query(sql, params);
  }

  async addMerchantTendors(merchantId: string, tendorIds: string[]): Promise<{ count: number; tendorIds: string[] }> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const uniqueIds = [...new Set(tendorIds.map(String))];
    if (!uniqueIds.length) throw new BadRequestException('tendorIds is required');
    const db = this.merchants.requireDataSource();
    const found = await db.query(
      `SELECT id FROM public.tendors WHERE id = ANY($1::uuid[]) AND is_deleted = FALSE`,
      [uniqueIds],
    );
    if (found.length !== uniqueIds.length) throw new NotFoundException('One or more tendors were not found');
    await db.query(
      `INSERT INTO public.merchant_tendors (merchant_id, tendor_id, tendor_code, status)
       SELECT $1::uuid, t.id, t.tendor_code, 'ACTIVE'
       FROM unnest($2::uuid[]) AS x(tendor_id)
       JOIN public.tendors t ON t.id = x.tendor_id
       ON CONFLICT (merchant_id, tendor_id) DO UPDATE
         SET tendor_code = EXCLUDED.tendor_code, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`,
      [merchantUuid, uniqueIds],
    );
    return { count: uniqueIds.length, tendorIds: uniqueIds };
  }

  async removeMerchantTendor(merchantId: string, tendorId: string): Promise<void> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const result = await this.merchants.requireDataSource().query(
      `DELETE FROM public.merchant_tendors WHERE merchant_id = $1::uuid AND tendor_id = $2::uuid RETURNING id`,
      [merchantUuid, tendorId],
    );
    if (!result.length) throw new NotFoundException('Merchant tendor mapping not found');
  }

  async list(query: { status?: string; search?: string } = {}): Promise<TendorEntity[]> {
    const where: Record<string, unknown> = { isDeleted: false };
    const status = normalizeStatus(query.status);
    if (status) where.status = status;
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
    const tendor = await this.store().findOne({ where: { id, isDeleted: false } });
    if (!tendor) throw new NotFoundException(`Tendor '${id}' not found`);
    return tendor;
  }

  async create(dto: CreateTendorDto): Promise<TendorEntity> {
    const tendorCode = normalizeText(dto.tendorCode) ?? `TND-${randomUUID()}`;
    const tendorName = this.requireText(dto.tendorName, 'tendorName');
    await this.assertUniqueFields(tendorCode, tendorName);
    const entity = this.store().create({
      tendorCode,
      tendorName,
      status: ((normalizeStatus(dto.status) || TendorStatus.ACTIVE) as TendorStatus),
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
    const tendorCode = dto.tendorCode !== undefined ? this.requireText(dto.tendorCode, 'tendorCode') : undefined;
    const tendorName = dto.tendorName !== undefined ? this.requireText(dto.tendorName, 'tendorName') : undefined;
    await this.assertUniqueFields(tendorCode, tendorName, existing.id);
    if (tendorCode !== undefined) existing.tendorCode = tendorCode;
    if (tendorName !== undefined) existing.tendorName = tendorName;
    if (dto.status !== undefined) existing.status = normalizeStatus(dto.status) as TendorStatus;
    try {
      return await this.store().save(existing);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw this.uniqueConflict(error, existing.tendorCode, existing.tendorName);
      }
      throw error;
    }
  }

  async deactivate(id: string): Promise<void> {
    await this.getById(id);
    await this.store().update({ id, isDeleted: false }, { status: TendorStatus.INACTIVE });
  }
}