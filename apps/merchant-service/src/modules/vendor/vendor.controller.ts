import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import { VendorRepository } from './vendor.repository';
import { CreateVendorDto, UpdateVendorDto, normalizeVendorType } from './vendor.dto';
import { VendorFormValidationPipe } from '../master/tenders/vendor-tendor.form.pipe';
import { VendorStatus, VendorType } from '../../entities/vendor.entity';
import { RequireAuth } from '../shared/session-auth.guard';

type AuthenticatedRequest = { user?: { id?: string } };

const createValidation = new VendorFormValidationPipe({
  expectedType: CreateVendorDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const patchValidation = new VendorFormValidationPipe({
  expectedType: UpdateVendorDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  skipUndefinedProperties: true,
});

@Controller(['api/v1/vendors', 'connector/api/v1/vendors', 'vendors'])
@RequireAuth()
export class VendorController {
  constructor(@Inject(VendorRepository) private readonly repository: VendorRepository) {}

  private actorId(request: AuthenticatedRequest): string {
    const id = request.user?.id;
    if (!id) throw new UnauthorizedException('Authenticated user ID is missing');
    return id;
  }

  @Get()
  async list(@Query() query: Record<string, string>) {
    const vendorType = normalizeVendorType(query.vendorType || query.type);
    if (vendorType && vendorType !== VendorType.ORGANIZER && vendorType !== VendorType.SUPPLIER) {
      throw new BadRequestException('vendorType must be ORGANIZER or SUPPLIER');
    }
    const status = query.status?.trim().toUpperCase();
    if (status && status !== 'ALL' && status !== VendorStatus.ACTIVE && status !== VendorStatus.INACTIVE) {
      throw new BadRequestException('Invalid status');
    }
    const isDeleted = this.parseIsDeleted(query.isDeleted ?? query.is_deleted);
    const vendors = await this.repository.list({
      vendorType: vendorType === VendorType.ORGANIZER || vendorType === VendorType.SUPPLIER ? vendorType : undefined,
      status: status && status !== 'ALL' ? status : undefined,
      search: query.search,
      isDeleted,
    });
    return { success: true, count: vendors.length, vendors };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: Record<string, string>) {
    return {
      success: true,
      vendor: await this.repository.getById(id, this.parseIsDeleted(query.isDeleted ?? query.is_deleted)),
    };
  }

  @Post()
  async create(@Body(createValidation) body: CreateVendorDto, @Req() request: AuthenticatedRequest) {
    return { success: true, message: 'Vendor created', vendor: await this.repository.create(body, this.actorId(request)) };
  }

  @Put(':id')
  async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(createValidation) body: CreateVendorDto, @Req() request: AuthenticatedRequest) {
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body, this.actorId(request)) };
  }

  @Patch(':id')
  async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(patchValidation) body: UpdateVendorDto, @Req() request: AuthenticatedRequest) {
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body, this.actorId(request)) };
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    await this.repository.remove(id, this.actorId(request));
    return { success: true, message: 'Vendor soft deleted', isDeleted: true };
  }

  private parseIsDeleted(value?: string): boolean {
    if (value === undefined) return false;
    const normalized = value.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      throw new BadRequestException('isDeleted must be true or false');
    }
    return normalized === 'true';
  }
}
