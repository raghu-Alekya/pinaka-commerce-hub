import { BadRequestException, Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { extractBearerToken, verifyAccessToken } from '@pch/auth';
import { SalesReportsService } from './sales-reports';

@Controller('api/v1/reports-new')
export class SalesReportsController {
  constructor(@Inject(SalesReportsService) private readonly reports: SalesReportsService) {}

  @Get('sales')
  async sales(
    @Headers('authorization') authorization?: string,
    @Headers('x-store-id') storeId?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Query('type') type?: string,
  ) {
    verifyAccessToken(extractBearerToken(authorization));
    if (!storeId?.trim() || !merchantId?.trim()) {
      throw new BadRequestException('X-Store-Id and X-Merchant-Id headers are required');
    }
    return this.reports.sales(type, storeId.trim(), merchantId.trim());
  }

  @Get('shift-sales')
  async shiftSales(
    @Headers('authorization') authorization?: string,
    @Headers('x-store-id') storeId?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Query('date') date?: string,
  ) {
    verifyAccessToken(extractBearerToken(authorization));
    if (!storeId?.trim() || !merchantId?.trim()) {
      throw new BadRequestException('X-Store-Id and X-Merchant-Id headers are required');
    }
    return this.reports.shiftSales(date, storeId.trim(), merchantId.trim());
  }
}
