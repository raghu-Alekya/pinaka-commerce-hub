import { BadRequestException, Body, Controller, Delete, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import { extractBearerToken, verifyAccessToken } from '@pinaka-delivery-hub/auth';
import { VendorRepository } from './vendor.repository';
import { CreateVendorDto, UpdateVendorDto, normalizeVendorType } from './vendor.dto';
import { VendorFormValidationPipe } from '../master/tenders/vendor-tendor.form.pipe';
import { VendorStatus, VendorType } from '../../entities/vendor.entity';
import { RequireAuth } from '../shared/session-auth.guard';
import { isWebConsoleRequest } from '../shared/console-access';

type AuthenticatedRequest = { headers?: { 'x-pch-web-console'?: string }; user?: { id?: string; merchantId?: string; storeId?: string; role?: string; accountType?: string } };

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

@Controller(['api/v1/store-vendor-payments', 'connector/api/v1/store-vendor-payments'])
@RequireAuth()
export class StoreVendorPaymentController {
  constructor(@Inject(VendorRepository) private readonly repository: VendorRepository) {}

  @Get()
  async list(
    @Query('merchant_id') merchantId?: string,
    @Query('store_id') storeId?: string,
    @Query('shift_id') shiftId?: string,
    @Headers('authorization') authorization?: string,
  ) {
    verifyAccessToken(extractBearerToken(authorization));
    const payments = await this.repository.listStoreVendorPayments(merchantId, storeId, shiftId);
    return {
      success: true,
      merchant_id: merchantId,
      store_id: storeId,
      shift_id: shiftId?.trim(),
      count: payments.length,
      payments,
    };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest, @Headers('authorization') authorization?: string) {
    verifyAccessToken(extractBearerToken(authorization));
    return { success: true, message: 'Vendor payment created',
      payment: await this.repository.createStoreVendorPayment(body, request.user) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Headers('authorization') authorization?: string) {
    verifyAccessToken(extractBearerToken(authorization));
    return {
      success: true,
      message: 'Vendor payment updated',
      payment: await this.repository.changeStoreVendorPayment(id, body),
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    verifyAccessToken(extractBearerToken(authorization));
    return {
      success: true,
      message: 'Vendor payment soft-deleted',
      payment: await this.repository.changeStoreVendorPayment(id, {}, true),
    };
  }
}

@Controller(['api/v1/vendors', 'connector/api/v1/vendors', 'vendors'])
@RequireAuth()
export class VendorController {
  constructor(@Inject(VendorRepository) private readonly repository: VendorRepository) {}

  private actorId(request: AuthenticatedRequest): string {
    const id = request.user?.id;
    if (!id) throw new UnauthorizedException('Authenticated user ID is missing');
    return id;
  }

  private scopedMerchantId(request: AuthenticatedRequest): string | undefined {
    if (!isWebConsoleRequest(request)) return undefined;
    if (request.user?.accountType !== 'merchant' && request.user?.accountType !== 'employee') return undefined;
    if (!request.user.merchantId) throw new UnauthorizedException('Merchant context is missing');
    return request.user.merchantId;
  }

  @Get()
  async list(@Query() query: Record<string, string>, @Req() request: AuthenticatedRequest) {
    const vendorType = normalizeVendorType(query.vendorType || query.type);
    if (vendorType && vendorType !== VendorType.ORGANIZER && vendorType !== VendorType.SUPPLIER) {
      throw new BadRequestException('vendorType must be ORGANIZER or SUPPLIER');
    }
    const status = query.status?.trim().toUpperCase();
    if (status && status !== 'ALL' && status !== VendorStatus.ACTIVE && status !== VendorStatus.INACTIVE) {
      throw new BadRequestException('Invalid status');
    }
    const includeDeleted = this.parseDeletedAt(query.deleted_at);
    const merchantId = this.scopedMerchantId(request);
    if (merchantId) {
      const vendors = await this.repository.listMerchantVendors(merchantId, {
        vendorType: vendorType === VendorType.ORGANIZER || vendorType === VendorType.SUPPLIER ? vendorType : undefined,
        status: status && status !== 'ALL' ? status : undefined,
        search: query.search,
        includeDeleted,
      });
      return { success: true, count: vendors.length, vendors };
    }
    const vendors = await this.repository.list({
      vendorType: vendorType === VendorType.ORGANIZER || vendorType === VendorType.SUPPLIER ? vendorType : undefined,
      status: status && status !== 'ALL' ? status : undefined,
      search: query.search,
      includeDeleted,
    });
    return { success: true, count: vendors.length, vendors };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: Record<string, string>, @Req() request: AuthenticatedRequest) {
    const merchantId = this.scopedMerchantId(request);
    if (merchantId) await this.repository.assertMerchantVendor(merchantId, id);
    return {
      success: true,
      vendor: await this.repository.getById(id, this.parseDeletedAt(query.deleted_at)),
    };
  }

  @Post()
  async create(@Body(createValidation) body: CreateVendorDto, @Req() request: AuthenticatedRequest) {
    return { success: true, message: 'Vendor created', vendor: await this.repository.create(body, this.actorId(request), this.scopedMerchantId(request)) };
  }

  @Put(':id')
  async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(createValidation) body: CreateVendorDto, @Req() request: AuthenticatedRequest) {
    const merchantId = this.scopedMerchantId(request);
    if (merchantId) await this.repository.assertMerchantVendor(merchantId, id);
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body, this.actorId(request)) };
  }

  @Patch(':id')
  async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(patchValidation) body: UpdateVendorDto, @Req() request: AuthenticatedRequest) {
    const merchantId = this.scopedMerchantId(request);
    if (merchantId) await this.repository.assertMerchantVendor(merchantId, id);
    return { success: true, message: 'Vendor updated', vendor: await this.repository.update(id, body, this.actorId(request)) };
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    const merchantId = this.scopedMerchantId(request);
    if (merchantId) await this.repository.assertMerchantVendor(merchantId, id);
    await this.repository.remove(id, this.actorId(request));
    return { success: true, message: 'Vendor soft deleted', isDeleted: true };
  }

  private parseDeletedAt(value?: string): boolean {
    if (value === undefined) return false;
    const normalized = value.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      throw new BadRequestException('deleted_at must be true or false');
    }
    return normalized === 'true';
  }
}
