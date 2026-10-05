import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  RoleTemplateEntity,
  RoleTemplateStatus,
  RoleScopeType,
} from '../../../entities/role-template.entity';
import { MerchantRepository } from '../../merchant/merchant.repository';
import {
  CreateRoleTemplateDto,
  UpdateRoleTemplateDto,
} from './role-template.dto';

@Injectable()
export class RoleTemplateRepository {
  constructor(
    @Inject(MerchantRepository)
    private readonly merchants: MerchantRepository,
  ) {}

  private repository(): Repository<RoleTemplateEntity> {
    return this.merchants.requireDataSource().getRepository(RoleTemplateEntity);
  }

  /**
   * Preview next auto-generated code (Format: RLC_001, RLC_002, ...) without advancing sequence
   */
  async previewNextCode(): Promise<string> {
    try {
      const rows = await this.merchants
        .requireDataSource()
        .query(
          `SELECT last_value, is_called FROM public.role_template_code_seq`,
        );
      const sequence = rows[0] as
        | { last_value?: string | number; is_called?: boolean }
        | undefined;
      const lastValue = Number(sequence?.last_value || 1);
      const nextValue = sequence?.is_called ? lastValue + 1 : lastValue;
      return `RLC_${String(nextValue).padStart(3, '0')}`;
    } catch {
      try {
        const count = await this.repository().count();
        return `RLC_${String(count + 1).padStart(3, '0')}`;
      } catch {
        return `RLC_001`;
      }
    }
  }

  /**
   * Advance PostgreSQL sequence and return new code value
   */
  async consumeNextCode(): Promise<string> {
    try {
      const rows = await this.merchants
        .requireDataSource()
        .query(`SELECT nextval('public.role_template_code_seq') AS val`);
      const val = Number(rows[0]?.val || 1);
      return `RLC_${String(val).padStart(3, '0')}`;
    } catch {
      return this.previewNextCode();
    }
  }

  async list(status?: string): Promise<RoleTemplateEntity[]> {
    const repository = this.repository();
    let qb = repository
      .createQueryBuilder('rt')
      .where('(rt.isDeleted = false OR rt.isDeleted IS NULL)');
    if (status) {
      qb = qb.andWhere('UPPER(rt.status) = UPPER(:status)', { status });
    }
    return qb.orderBy('rt.name', 'ASC').getMany();
  }

  async findByIdOrCode(idOrCode: string): Promise<RoleTemplateEntity | null> {
    if (!idOrCode?.trim()) return null;
    const repository = this.repository();
    const value = idOrCode.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      );

    if (isUuid) {
      const byId = await repository
        .createQueryBuilder('rt')
        .where(
          'rt.id = :id AND (rt.isDeleted = false OR rt.isDeleted IS NULL)',
          { id: value },
        )
        .getOne();
      if (byId) return byId;
    }

    return repository
      .createQueryBuilder('rt')
      .where(
        '(UPPER(rt.roleCode) = UPPER(:code) OR UPPER(rt.name) = UPPER(:code)) AND (rt.isDeleted = false OR rt.isDeleted IS NULL)',
        { code: value },
      )
      .getOne();
  }

  async findByName(name: string): Promise<RoleTemplateEntity | null> {
    if (!name?.trim()) return null;
    return this.repository()
      .createQueryBuilder('rt')
      .where('LOWER(TRIM(rt.name)) = LOWER(TRIM(:name))', { name })
      .andWhere('(rt.isDeleted = false OR rt.isDeleted IS NULL)')
      .getOne();
  }

  async create(
    dto: CreateRoleTemplateDto,
    loginUserId?: string | null,
  ): Promise<RoleTemplateEntity> {
    const duplicate = await this.findByName(dto.name);

    if (duplicate) {
      throw new ConflictException(
        `Role template name '${dto.name.trim()}' already exists`,
      );
    }

    const repository = this.repository();

    // Backend automatically generates RLC_001, RLC_002, RLC_003...
    const code = await this.consumeNextCode();

    const entity = repository.create({
      roleCode: code,
      name: dto.name.trim(),
      description: dto.description?.trim() || '',
      scopeType: dto.scopeType || RoleScopeType.STORE,
      status: dto.status || RoleTemplateStatus.ACTIVE,
      createdBy: loginUserId || null,
      updatedBy: null,
    });

    const saved = await repository.save(entity);

    return (await this.findByIdOrCode(saved.id)) || saved;
  }

  async update(
    idOrCode: string,
    dto: UpdateRoleTemplateDto,
    loginUserId?: string | null,
  ): Promise<RoleTemplateEntity | null> {
    const existing = await this.findByIdOrCode(idOrCode);
    if (!existing) return null;

    if (dto.name !== undefined) {
      const duplicate = await this.findByName(dto.name);
      if (duplicate && duplicate.id !== existing.id) {
        throw new ConflictException(
          `Role template name '${dto.name.trim()}' already exists`,
        );
      }
      existing.name = dto.name.trim();
    }

    if (dto.description !== undefined)
      existing.description = dto.description.trim();
    if (dto.scopeType !== undefined) existing.scopeType = dto.scopeType;
    if (dto.status !== undefined) existing.status = dto.status;

    existing.updatedBy = loginUserId || null;
    existing.updatedAt = new Date();

    return this.repository().save(existing);
  }

  async softDelete(
    idOrCode: string,
    loginUserId?: string | null,
  ): Promise<boolean> {
    const existing = await this.findByIdOrCode(idOrCode);
    if (!existing) return false;
    existing.isDeleted = true;
    existing.updatedBy = loginUserId || null;
    existing.updatedAt = new Date();
    await this.repository().save(existing);
    return true;
  }
}
