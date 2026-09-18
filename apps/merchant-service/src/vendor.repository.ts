import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, IsNull, Repository } from 'typeorm';
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
      address: optionalText(dto.address),
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
    if (dto.address !== undefined) existing.address = optionalText(dto.address);
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

  async softDelete(id: string): Promise<void> {
    await this.getById(id);
    await this.store().softDelete({ id, deletedAt: IsNull() });
  }
}
