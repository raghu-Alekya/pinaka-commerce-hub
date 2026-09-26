import { EmployeeEntity } from '../entities/employee.entity';
import { FeatureEntity } from '../entities/feature.entity';
import { MerchantEntity } from '../entities/merchant.entity';
import { StoreEntity } from '../entities/store.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { RoleTemplateRecord } from './role-template-filter.dto';

export interface MerchantAggregatedData {
  merchant: MerchantEntity;
  stores: StoreEntity[];
  employees: EmployeeEntity[];
  subscriptions: SubscriptionEntity[];
  roleTemplates: RoleTemplateRecord[];
  features: FeatureEntity[];
}
