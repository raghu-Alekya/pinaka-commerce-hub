import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { DynamicQueryService } from './dynamic-query.service';
import { EmployeeFilterDTO } from './employee-filter.dto';
import { FeatureFilterDTO } from './feature-filter.dto';
import { RoleTemplateFilterDTO } from './role-template-filter.dto';
import { StoreFilterDTO } from './store-filter.dto';
import { SubscriptionFilterDTO } from './subscription-filter.dto';
import { VendorFilterDTO } from './vendor-filter.dto';

@Controller(['api/v1/query', 'connector/api/v1/query'])
export class DynamicQueryController {
  constructor(@Inject(DynamicQueryService) private readonly queries: DynamicQueryService) {}

  @Get('employees')
  getEmployees(@Query() filter: EmployeeFilterDTO) {
    return this.queries.getEmployees(filter);
  }

  @Get('stores')
  getStores(@Query() filter: StoreFilterDTO) {
    return this.queries.getStores(filter);
  }

  @Get('vendors')
  getVendors(@Query() filter: VendorFilterDTO) {
    return this.queries.getVendors(filter);
  }

  @Get('subscriptions')
  getSubscriptions(@Query() filter: SubscriptionFilterDTO) {
    return this.queries.getSubscriptions(filter);
  }

  @Get('role-templates')
  getRoleTemplates(@Query() filter: RoleTemplateFilterDTO) {
    return this.queries.getRoleTemplates(filter);
  }

  @Get('features')
  getFeatures(@Query() filter: FeatureFilterDTO) {
    return this.queries.getFeatures(filter);
  }

  @Get('merchants/:merchantId')
  getMerchantAggregatedData(@Param('merchantId') merchantId: string) {
    return this.queries.getMerchantAggregatedData(merchantId);
  }
}
