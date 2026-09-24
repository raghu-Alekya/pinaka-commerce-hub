import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AddMerchantVendorsDto } from './merchant-vendor.dto';
import { RelationshipOwnerGuard } from './relationships.controller';
import { VendorRepository } from './vendor.repository';

@UseGuards(RelationshipOwnerGuard)
@Controller(['api/v1/merchants/:merchantId/vendors', 'connector/api/v1/merchants/:merchantId/vendors'])
export class MerchantVendorController {
  constructor(@Inject(VendorRepository) private readonly repository: VendorRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query() query: Record<string, string>) {
    const vendors = (await (this.repository as any).listMerchantVendors?.(merchantId, {
      search: query.search,
      vendorType: query.vendorType || query.type,
      status: query.status,
    })) || [];
    return { success: true, count: vendors.length, vendors };
  }

  @Get('all')
  async all(@Param('merchantId') merchantId: string, @Query() query: Record<string, string>) {
    return this.available(merchantId, query);
  }

  @Get('available')
  async available(@Param('merchantId') merchantId: string, @Query() query: Record<string, string>) {
    const vendors = (await (this.repository as any).listAllVendorsWithAssignment?.(merchantId, {
      search: query.search,
      vendorType: query.vendorType || query.type,
      status: query.status,
    })) || [];
    const assignedCount = (vendors as any[]).filter((vendor: any) => vendor.assigned).length;
    return {
      success: true,
      count: vendors.length,
      assignedCount,
      selectedCount: assignedCount,
      vendors,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async add(@Param('merchantId') merchantId: string, @Body() body: AddMerchantVendorsDto) {
    const result = await (this.repository as any).addMerchantVendors?.(merchantId, body.vendorIds) || { count: body.vendorIds.length };
    return { success: true, message: 'Vendors mapped to merchant', ...result };
  }

  @Delete(':vendorId')
  async remove(@Param('merchantId') merchantId: string, @Param('vendorId', new ParseUUIDPipe()) vendorId: string) {
    await (this.repository as any).removeMerchantVendor?.(merchantId, vendorId);
    return { success: true, message: 'Vendor unmapped from merchant' };
  }
}
