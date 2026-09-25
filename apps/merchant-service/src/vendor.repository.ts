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

  async resolveMerchantUuid(merchantId: string): Promise<string | null> {
    const ds = this.merchants.requireDataSource();
    const rows = await ds.query(
      'SELECT id FROM public.merchants WHERE id::text = $1 OR "merchantId" = $1 OR "merchantCode" = $1 LIMIT 1',
      [merchantId]
    );
    return rows[0]?.id || null;
  }

  async listMerchantVendors(merchantId: string, query: { search?: string; vendorType?: string; status?: string } = {}): Promise<any[]> {
    const ds = this.merchants.requireDataSource();
    const mUuid = await this.resolveMerchantUuid(merchantId);
    if (!mUuid) return [];

    let sql = 'SELECT v.*, mv.status AS "merchantVendorStatus", true AS assigned FROM public.vendors v JOIN public.merchant_vendors mv ON mv.vendor_id = v.id WHERE mv.merchant_id = $1 AND mv.status = \'ACTIVE\' AND v."deletedAt" IS NULL';
    const params = [mUuid];
    let pIndex = 2;

    if (query.status) {
      sql += ' AND v.status = $' + (pIndex++);
      params.push(query.status);
    }
    if (query.vendorType) {
      sql += ' AND v."vendorType" = $' + (pIndex++);
      params.push(query.vendorType);
    }
    if (query.search && query.search.trim()) {
      sql += ' AND (v."vendorName" ILIKE $' + pIndex + ' OR v."vendorCode" ILIKE $' + pIndex + ' OR v."contactPerson" ILIKE $' + pIndex + ' OR v."productCategory" ILIKE $' + pIndex + ')';
      params.push('%' + query.search.trim() + '%');
      pIndex++;
    }

    sql += ' ORDER BY v."vendorName" ASC, v.id ASC';
    return ds.query(sql, params);
  }

  async listAllVendorsWithAssignment(merchantId: string, query: { search?: string; vendorType?: string; status?: string } = {}): Promise<any[]> {
    const ds = this.merchants.requireDataSource();
    const mUuid = await this.resolveMerchantUuid(merchantId);

    let sql = 'SELECT v.*, (mv.id IS NOT NULL AND mv.status = \'ACTIVE\') AS assigned FROM public.vendors v LEFT JOIN public.merchant_vendors mv ON mv.vendor_id = v.id AND mv.merchant_id = $1 AND mv.status = \'ACTIVE\' WHERE v."deletedAt" IS NULL';
    const params = [mUuid || '00000000-0000-0000-0000-000000000000'];
    let pIndex = 2;

    if (query.status) {
      sql += ' AND v.status = $' + (pIndex++);
      params.push(query.status);
    }
    if (query.vendorType) {
      sql += ' AND v."vendorType" = $' + (pIndex++);
      params.push(query.vendorType);
    }
    if (query.search && query.search.trim()) {
      sql += ' AND (v."vendorName" ILIKE $' + pIndex + ' OR v."vendorCode" ILIKE $' + pIndex + ' OR v."contactPerson" ILIKE $' + pIndex + ' OR v."productCategory" ILIKE $' + pIndex + ')';
      params.push('%' + query.search.trim() + '%');
      pIndex++;
    }

    sql += ' ORDER BY v."vendorName" ASC, v.id ASC';
    return ds.query(sql, params);
  }

  async addMerchantVendors(merchantId: string, vendorIds: string[]): Promise<{ count: number }> {
    const ds = this.merchants.requireDataSource();
    const mUuid = await this.resolveMerchantUuid(merchantId);
    if (!mUuid) throw new NotFoundException('Merchant ' + merchantId + ' not found');

    for (const vId of vendorIds) {
      await ds.query(
        'INSERT INTO public.merchant_vendors (merchant_id, vendor_id, status, created_at, updated_at) VALUES ($1, $2, \'ACTIVE\', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (merchant_id, vendor_id) DO UPDATE SET status = \'ACTIVE\', updated_at = CURRENT_TIMESTAMP',
        [mUuid, vId]
      );
    }
    return { count: vendorIds.length };
  }

  async removeMerchantVendor(merchantId: string, vendorId: string): Promise<void> {
    const ds = this.merchants.requireDataSource();
    const mUuid = await this.resolveMerchantUuid(merchantId);
    if (!mUuid) throw new NotFoundException('Merchant ' + merchantId + ' not found');

    await ds.query(
      'UPDATE public.merchant_vendors SET status = \'INACTIVE\', updated_at = CURRENT_TIMESTAMP WHERE merchant_id = $1 AND vendor_id = $2',
      [mUuid, vendorId]
    );
  }
}
