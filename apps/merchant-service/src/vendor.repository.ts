import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, In, Repository } from 'typeorm';
import { MerchantRepository } from './merchant.repository';
import { VendorEntity, VendorStatus, VendorType } from './entities/vendor.entity';
import { MerchantVendorEntity, MerchantVendorStatus } from './entities/merchant-vendor.entity';
import { CreateVendorDto, UpdateVendorDto } from './vendor.dto';

const optionalText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

type VendorAssignment = VendorEntity & {
  assigned: boolean;
  mapped: boolean;
  name: string;
  type: VendorType;
  contact: string | null;
  assignedStoreCount: number;
};

const presentVendor = (vendor: VendorEntity, extra: Partial<VendorAssignment> = {}) => ({
  ...vendor,
  name: vendor.vendorName,
  type: vendor.vendorType,
  contact: vendor.contactPerson ?? null,
  assignedStoreCount: extra.assignedStoreCount ?? 0,
  ...extra,
});

@Injectable()
export class VendorRepository {
  private repo?: Repository<VendorEntity>;
  private mappingRepo?: Repository<MerchantVendorEntity>;

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private store() {
    this.repo ??= this.merchants.requireDataSource().getRepository(VendorEntity);
    return this.repo;
  }

  private mappings() {
    this.mappingRepo ??= this.merchants.requireDataSource().getRepository(MerchantVendorEntity);
    return this.mappingRepo;
  }

  private async requireMerchantUuid(merchantId: string): Promise<string> {
    const merchantUuid = await this.merchants.resolveMerchantUuid(merchantId);
    if (!merchantUuid) throw new NotFoundException(`Merchant '${merchantId}' not found`);
    return merchantUuid;
  }

  private matchesVendorQuery(vendor: VendorEntity, query: { vendorType?: string; status?: string; search?: string } = {}) {
    if (query.vendorType && vendor.vendorType !== query.vendorType) return false;
    if (query.status && vendor.status !== query.status) return false;
    const search = query.search?.trim().toLowerCase();
    if (!search) return true;
    return [vendor.vendorName, vendor.vendorCode, vendor.contactPerson, vendor.productCategory, vendor.vendorType]
      .some(value => value?.toLowerCase().includes(search));
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

  async listMerchantVendors(merchantId: string, query: { vendorType?: string; status?: string; search?: string } = {}): Promise<VendorEntity[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const mappings = await this.mappings().find({
      where: { merchantId: merchantUuid, status: MerchantVendorStatus.ACTIVE },
      relations: { vendor: true },
      order: { createdAt: 'ASC' },
    });
    return mappings
      .map(mapping => mapping.vendor)
      .filter((vendor): vendor is VendorEntity => Boolean(vendor))
      .filter(vendor => this.matchesVendorQuery(vendor, query))
      .map(vendor => presentVendor(vendor));
  }

  async listAllVendorsWithAssignment(merchantId: string, query: { vendorType?: string; status?: string; search?: string } = {}): Promise<VendorAssignment[]> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const [vendors, mappings] = await Promise.all([
      this.list(query),
      this.mappings().find({ where: { merchantId: merchantUuid }, select: { id: true, vendorId: true } }),
    ]);
    const assignedIds = new Set(mappings.map(mapping => mapping.vendorId));
    return vendors.map(vendor => {
      const assigned = assignedIds.has(vendor.id);
      return presentVendor(vendor, { assigned, mapped: assigned });
    });
  }

  async addMerchantVendors(merchantId: string, vendorIds: string[]): Promise<{ added: string[]; alreadyMapped: string[]; count: number }> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const uniqueIds = [...new Set(vendorIds)];
    const vendors = await this.store().find({ where: { id: In(uniqueIds) } });
    const found = new Set(vendors.map(vendor => vendor.id));
    const missing = uniqueIds.filter(id => !found.has(id));
    if (missing.length) throw new NotFoundException(`Vendor(s) not found: ${missing.join(', ')}`);

    const existing = await this.mappings().find({
      where: { merchantId: merchantUuid, vendorId: In(uniqueIds) },
    });
    const alreadyMapped = existing.map(mapping => mapping.vendorId);
    const already = new Set(alreadyMapped);
    const added = uniqueIds.filter(id => !already.has(id));
    if (added.length) {
      await this.mappings().save(
        added.map(vendorId => this.mappings().create({
          merchantId: merchantUuid,
          vendorId,
          status: MerchantVendorStatus.ACTIVE,
        })),
      );
    }
    return { added, alreadyMapped, count: added.length };
  }

  async removeMerchantVendor(merchantId: string, vendorId: string): Promise<void> {
    const merchantUuid = await this.requireMerchantUuid(merchantId);
    const mapping = await this.mappings().findOne({ where: { merchantId: merchantUuid, vendorId } });
    if (!mapping) throw new NotFoundException(`Vendor '${vendorId}' is not mapped to merchant '${merchantId}'`);
    await this.mappings().remove(mapping);
  }
}
