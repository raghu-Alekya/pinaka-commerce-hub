import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AddMerchantTendorsDto } from './merchant-tendor.dto';
import { RelationshipOwnerGuard } from './relationships.controller';
import { TendorRepository } from './tendor.repository';

@UseGuards(RelationshipOwnerGuard)
@Controller([
  'api/v1/merchants/:merchantId/tendors',
  'connector/api/v1/merchants/:merchantId/tendors',
  'merchants/:merchantId/tendors',
])
export class MerchantTendorController {
  constructor(@Inject(TendorRepository) private readonly repository: TendorRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query() query: Record<string, string>) {
    const tendors = await this.repository.listMerchantTendors(merchantId, {
      search: query.search,
      status: query.status,
    });
    return { success: true, count: tendors.length, tendors };
  }

  @Get('available')
  async available(@Param('merchantId') merchantId: string, @Query() query: Record<string, string>) {
    const tendors = await this.repository.listAllTendorsWithAssignment(merchantId, {
      search: query.search,
      status: query.status,
    });
    const assignedCount = tendors.filter((tendor: any) => tendor.assigned).length;
    return { success: true, count: tendors.length, assignedCount, selectedCount: assignedCount, tendors };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async add(@Param('merchantId') merchantId: string, @Body() body: AddMerchantTendorsDto) {
    const result = await this.repository.addMerchantTendors(merchantId, body.tendorIds);
    return { success: true, message: 'Tendors mapped to merchant', ...result };
  }

  @Delete(':tendorId')
  async remove(
    @Param('merchantId') merchantId: string,
    @Param('tendorId', new ParseUUIDPipe()) tendorId: string,
  ) {
    await this.repository.removeMerchantTendor(merchantId, tendorId);
    return { success: true, message: 'Tendor unmapped from merchant' };
  }
}
