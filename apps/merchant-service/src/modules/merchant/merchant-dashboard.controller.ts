import { Controller, Get, Inject, Query, Req, UnauthorizedException } from '@nestjs/common';
import { MerchantDashboardService } from './merchant-dashboard.service';

type MerchantRequest = { user?: { merchantId?: string; accountType?: string; storeId?: string } };

@Controller('api/v1/merchant-dashboard')
export class MerchantDashboardController {
  constructor(@Inject(MerchantDashboardService) private readonly dashboard: MerchantDashboardService) {}

  @Get('stores')
  stores(@Req() request: MerchantRequest) {
    return this.dashboard.stores(this.merchantId(request));
  }

  @Get('overview')
  overview(
    @Req() request: MerchantRequest,
    @Query('store_id') storeId?: string,
    // Backward compatibility for clients still sending the original camelCase query key.
    @Query('storeId') legacyStoreId?: string,
    @Query('period') period?: string,
  ) {
    return this.dashboard.overview(this.merchantId(request), storeId || legacyStoreId, period);
  }

  private merchantId(request: MerchantRequest): string {
    const user = request.user;
    if (!user?.merchantId || !['merchant', 'employee'].includes(String(user.accountType).toLowerCase())) {
      throw new UnauthorizedException('A merchant account is required');
    }
    return user.merchantId;
  }
}
