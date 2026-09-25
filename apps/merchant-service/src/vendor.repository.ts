import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, Repository } from 'typeorm';
import { MerchantRepository } from './merchant.repository';
import { VendorEntity, VendorStatus, VendorType } from './entities/vendor.entity';
import { CreateVendorDto, UpdateVendorDto } from './vendor.dto';

const optionalText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

@Injectable()
export class VendorRepository {
  private repo?: Repository<VendorEntity>;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private store() {
    this.repo ??= this.merchants.requireDataSource().getRepository(VendorEntity);
    return this.repo;
  }

  private assertOrganizerContact(vendorType: VendorType, contactPerson?: string | null) {
    if (vendorType === VendorType.ORGANIZER && !contactPerson?.trim()) {
      throw new BadRequestException('contactPerson is mandatory when vendorType is ORGANIZER');
    }
  }

  async list(query: { vendorType?: string; status?: string; search?: string } = {}): Promise<VendorEntity[]> {
    const where: Record<string, unknown> = {};
    if (query.vendorType) where.vendorType = query.vendorType;
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const search = ILike(`%${query.search.trim()}%`);
      return this.store().find({
        where: [
          { ...where, vendorName: search },
          { ...where, vendorCode: search },
          { ...where, contactPerson: search },
          { ...where, productCategory: search },
        ],
        order: { vendorName: 'ASC', id: 'ASC' },
      });
    }
    return this.store().find({ where, order: { vendorName: 'ASC', id: 'ASC' } });
  }

  async getById(id: string): Promise<VendorEntity> {
    const vendor = await this.store().findOne({ where: { id } });
    if (!vendor) throw new NotFoundException(`Vendor '${id}' not found`);
    return vendor;
  }

  async create(dto: CreateVendorDto): Promise<VendorEntity> {
    this.assertOrganizerContact(dto.vendorType, dto.contactPerson);
    const entity = this.store().create({
      vendorName: dto.vendorName.trim(),
      vendorType: dto.vendorType,
      vendorCode: optionalText(dto.vendorCode),
      contactPerson: optionalText(dto.contactPerson),
      phone: optionalText(dto.phone),
      email: optionalText(dto.email)?.toLowerCase(),
      productCategory: optionalText(dto.productCategory),
      addressLine1: optionalText(dto.addressLine1),
      addressLine2: optionalText(dto.addressLine2),
      city: optionalText(dto.city),
      state: optionalText(dto.state),
      zipCode: optionalText(dto.zipCode),
      country: optionalText(dto.country),
      status: dto.status || VendorStatus.ACTIVE,
    });
    try {
      return await this.store().save(entity);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException(`Vendor code '${dto.vendorCode}' already exists`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateVendorDto): Promise<VendorEntity> {
    const existing = await this.getById(id);
    if (dto.vendorName !== undefined) existing.vendorName = dto.vendorName.trim();
    if (dto.vendorType !== undefined) existing.vendorType = dto.vendorType;
    if (dto.vendorCode !== undefined) existing.vendorCode = optionalText(dto.vendorCode);
    if (dto.contactPerson !== undefined) existing.contactPerson = optionalText(dto.contactPerson);
    if (dto.phone !== undefined) existing.phone = optionalText(dto.phone);
    if (dto.email !== undefined) existing.email = optionalText(dto.email)?.toLowerCase() ?? null;
    if (dto.productCategory !== undefined) existing.productCategory = optionalText(dto.productCategory);
    if (dto.addressLine1 !== undefined) existing.addressLine1 = optionalText(dto.addressLine1);
    if (dto.addressLine2 !== undefined) existing.addressLine2 = optionalText(dto.addressLine2);
    if (dto.city !== undefined) existing.city = optionalText(dto.city);
    if (dto.state !== undefined) existing.state = optionalText(dto.state);
    if (dto.zipCode !== undefined) existing.zipCode = optionalText(dto.zipCode);
    if (dto.country !== undefined) existing.country = optionalText(dto.country);
    if (dto.status !== undefined) existing.status = dto.status;
    this.assertOrganizerContact(existing.vendorType, existing.contactPerson);
    try {
      return await this.store().save(existing);
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException(`Vendor code '${existing.vendorCode}' already exists`);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.getById(id);
    try {
      await this.store().createQueryBuilder().delete().from(VendorEntity).where('id = :id', { id }).execute();
    } catch (error: any) {
      if (error?.code === '23503' || error?.driverError?.code === '23503') {
        throw new ConflictException('Vendor is in use and cannot be deleted');
      }
      throw error;
    }
  }

  private async requireMerchantUuid(merchantId: string): Promise<string> {
    const uuid = await this.merchants.resolveMerchantUuid(merchantId);
    if (!uuid) throw new NotFoundException(`Merchant '${merchantId}' not found`);
    return uuid;
  }

  async listMerchantVendors(
    merchantId: string,
    query: { search?: string; vendorType?: string; status?: string } = {},
  ): Promise<any[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const db = this.merchants.requireDataSource();
    const params: unknown[] = [merchantUuid];
    let sql = `
      SELECT v.*, mv.status AS "assignmentStatus", mv.id AS "assignmentId", true AS assigned
      FROM public.merchant_vendors mv
      JOIN public.vendors v ON v.id = mv.vendor_id
      WHERE mv.merchant_id = $1
        AND mv.status = 'ACTIVE'
        AND v."deletedAt" IS NULL
    `;
    if (query.status) {
      params.push(query.status);
      sql += ` AND v.status = $${params.length}`;
    }
    if (query.vendorType) {
      params.push(query.vendorType);
      sql += ` AND v."vendorType" = $${params.length}`;
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const i = params.length;
      sql += ` AND (
        v."vendorName" ILIKE $${i}
        OR COALESCE(v."vendorCode", '') ILIKE $${i}
        OR COALESCE(v."contactPerson", '') ILIKE $${i}
        OR COALESCE(v."productCategory", '') ILIKE $${i}
      )`;
    }
    sql += ` ORDER BY v."vendorName" ASC, v.id ASC`;
    return db.query(sql, params);
  }

  async listAllVendorsWithAssignment(
    merchantId: string,
    query: { search?: string; vendorType?: string; status?: string } = {},
  ): Promise<any[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const db = this.merchants.requireDataSource();
    const params: unknown[] = [merchantUuid];
    let sql = `
      SELECT v.*,
             CASE WHEN mv.id IS NOT NULL AND mv.status = 'ACTIVE' THEN true ELSE false END AS assigned,
             mv.status AS "assignmentStatus",
             mv.id AS "assignmentId"
      FROM public.vendors v
      LEFT JOIN public.merchant_vendors mv
        ON mv.vendor_id = v.id AND mv.merchant_id = $1
      WHERE v."deletedAt" IS NULL
    `;
    if (query.status) {
      params.push(query.status);
      sql += ` AND v.status = $${params.length}`;
    } else {
      sql += ` AND v.status = 'ACTIVE'`;
    }
    if (query.vendorType) {
      params.push(query.vendorType);
      sql += ` AND v."vendorType" = $${params.length}`;
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const i = params.length;
      sql += ` AND (
        v."vendorName" ILIKE $${i}
        OR COALESCE(v."vendorCode", '') ILIKE $${i}
        OR COALESCE(v."contactPerson", '') ILIKE $${i}
        OR COALESCE(v."productCategory", '') ILIKE $${i}
      )`;
    }
    sql += ` ORDER BY assigned DESC, v."vendorName" ASC, v.id ASC`;
    return db.query(sql, params);
  }

  async addMerchantVendors(merchantId: string, vendorIds: string[]): Promise<{ count: number; vendorIds: string[] }> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const db = this.merchants.requireDataSource();
    const uniqueIds = [...new Set(vendorIds.map(String))];
    if (!uniqueIds.length) throw new BadRequestException('vendorIds is required');

    const found = await db.query(
      `SELECT id FROM public.vendors WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
      [uniqueIds],
    );
    if (found.length !== uniqueIds.length) {
      throw new NotFoundException('One or more vendors were not found');
    }

    await db.query(
      `INSERT INTO public.merchant_vendors (merchant_id, vendor_id, status)
       SELECT $1::uuid, x.vendor_id, 'ACTIVE'
       FROM unnest($2::uuid[]) AS x(vendor_id)
       ON CONFLICT (merchant_id, vendor_id) DO UPDATE
         SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`,
      [merchantUuid, uniqueIds],
    );
    return { count: uniqueIds.length, vendorIds: uniqueIds };
  }

  async removeMerchantVendor(merchantId: string, vendorId: string): Promise<void> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const db = this.merchants.requireDataSource();
    const result = await db.query(
      `DELETE FROM public.merchant_vendors
       WHERE merchant_id = $1::uuid AND vendor_id = $2::uuid
       RETURNING id`,
      [merchantUuid, vendorId],
    );
    if (!result.length) throw new NotFoundException('Merchant vendor mapping not found');
  }
}
