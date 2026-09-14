import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { BusinessType, RetailSubCategory, MerchantStatus } from './entities/merchant.entity';
import { StoreStatus } from './entities/store.entity';
import { SubscriptionStatus } from './entities/subscription.entity';
import { MerchantRepository } from './merchant.repository';

const labels = (values: string[]) => values.map(value => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

@Public()
@Controller('api/v1/reference-data')
export class ReferenceDataController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async get() {
    const dbStoreTypes = await this.repository.listStoreTypes('ACTIVE');
    const storeTypeOptions = dbStoreTypes.length > 0 
      ? dbStoreTypes.map(st => ({ code: st.storeTypeCode, name: st.name, description: st.description }))
      : ['Retail', 'Grocery', 'Restaurant', 'Liquor', 'Convenience', 'Fuel', 'Kiosk'].map(n => ({ code: n.toUpperCase(), name: n, description: '' }));

    return {
      businessTypes: labels(Object.values(BusinessType)),
      retailTypes: labels(Object.values(RetailSubCategory)),
      merchantStatuses: labels(Object.values(MerchantStatus)),
      storeStatuses: labels(Object.values(StoreStatus)),
      subscriptionStatuses: Object.values(SubscriptionStatus),
      storeTypes: storeTypeOptions,
      countries: ['United States', 'Canada', 'India', 'United Kingdom', 'Australia'],
      currencies: Intl.supportedValuesOf('currency'),
      timezones: Intl.supportedValuesOf('timeZone'),
      billingCycles: ['MONTHLY', 'ANNUAL', 'FREE_TRIAL'],
    };
  }
}
