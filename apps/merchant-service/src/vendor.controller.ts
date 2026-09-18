import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { VendorRepository } from './vendor.repository';
import { CreateVendorDto, UpdateVendorDto, normalizeVendorType } from './vendor.dto';
import { VendorFormValidationPipe } from './vendor-tendor.form.pipe';
import { VendorStatus, VendorType } from './entities/vendor.entity';

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

@Controller('api/v1/vendors')
export class VendorController {
  constructor(@Inject(VendorRepository) private readonly repository: VendorRepository) {}

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
    const vendors = await this.repository.list({
      vendorType: vendorType === VendorType.ORGANIZER || vendorType === VendorType.SUPPLIER ? vendorType : undefined,
      status: status && status !== 'ALL' ? status : undefined,
      search: query.search,
    });
    return { success: true, count: vendors.length, vendors };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return { success: true, vendor: await this.repository.getById(id) };
  }

  @Post()
  async create(@Body(createValidation) body: CreateVendorDto) {
    return { success: true, message: 'Vendor created', vendor: await this.repository.create(body) };
  }

  @Put(':id')
  async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(createValidation) body: CreateVendorDto) {
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body) };
  }

  @Patch(':id')
  async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(patchValidation) body: UpdateVendorDto) {
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.repository.softDelete(id);
    return { success: true, message: 'Vendor deleted' };
  }
}
