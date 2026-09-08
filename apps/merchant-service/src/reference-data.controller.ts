import { Controller, Get } from '@nestjs/common';
import { BusinessType, RetailSubCategory, MerchantStatus } from './entities/merchant.entity';
import { StoreStatus } from './entities/store.entity';
import { SubscriptionStatus } from './entities/subscription.entity';
const labels = (values: string[]) => values.map(value => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
@Controller('api/v1/reference-data')
export class ReferenceDataController {
 @Get() get() {
  return {
   businessTypes: labels(Object.values(BusinessType)), retailTypes: labels(Object.values(RetailSubCategory)),
   merchantStatuses: labels(Object.values(MerchantStatus)), storeStatuses: labels(Object.values(StoreStatus)),
   subscriptionStatuses: Object.values(SubscriptionStatus),
   storeTypes: ['Restaurant','Retail','Warehouse'],
   countries: ['United States','Canada','India','United Kingdom','Australia'],
   currencies: Intl.supportedValuesOf('currency'), timezones: Intl.supportedValuesOf('timeZone'),
   billingCycles: ['MONTHLY','ANNUAL','FREE_TRIAL'],
  };
 }
}
