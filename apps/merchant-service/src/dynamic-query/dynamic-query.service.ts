import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiResponse } from './api-response';
import { DynamicQueryRepository } from './dynamic-query.repository';
import { EmployeeFilterDTO } from './employee-filter.dto';
import { FeatureFilterDTO } from './feature-filter.dto';
import { MerchantAggregatedData } from './merchant-aggregated-data.dto';
import { ResponseUtil } from './response.util';
import { RoleTemplateFilterDTO, RoleTemplateRecord } from './role-template-filter.dto';
import { StoreFilterDTO } from './store-filter.dto';
import { SubscriptionFilterDTO } from './subscription-filter.dto';
import { VendorFilterDTO } from './vendor-filter.dto';
import { EmployeeEntity } from '../entities/employee.entity';
import { FeatureEntity } from '../entities/feature.entity';
import { StoreEntity } from '../entities/store.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { VendorEntity } from '../entities/vendor.entity';

@Injectable()
export class DynamicQueryService {
  constructor(@Inject(DynamicQueryRepository) private readonly repository: DynamicQueryRepository) {}

  async getEmployees(filter: EmployeeFilterDTO): Promise<ApiResponse<EmployeeEntity[]>> {
    const employees = await this.repository.getEmployees(filter);
    return ResponseUtil.getSuccessResponse('Employees loaded', employees);
  }

  async getStores(filter: StoreFilterDTO): Promise<ApiResponse<StoreEntity[]>> {
    const stores = await this.repository.getStores(filter);
    return ResponseUtil.getSuccessResponse('Stores loaded', stores);
  }

  async getVendors(filter: VendorFilterDTO): Promise<ApiResponse<VendorEntity[]>> {
    const vendors = await this.repository.getVendors(filter);
    return ResponseUtil.getSuccessResponse('Vendors loaded', vendors);
  }

  async getSubscriptions(filter: SubscriptionFilterDTO): Promise<ApiResponse<SubscriptionEntity[]>> {
    const subscriptions = await this.repository.getSubscriptions(filter);
    return ResponseUtil.getSuccessResponse('Subscriptions loaded', subscriptions);
  }

  async getRoleTemplates(filter: RoleTemplateFilterDTO): Promise<ApiResponse<RoleTemplateRecord[]>> {
    const roleTemplates = await this.repository.getRoleTemplates(filter);
    return ResponseUtil.getSuccessResponse('Role templates loaded', roleTemplates);
  }

  async getFeatures(filter: FeatureFilterDTO): Promise<ApiResponse<FeatureEntity[]>> {
    const features = await this.repository.getFeatures(filter);
    return ResponseUtil.getSuccessResponse('Features loaded', features);
  }

  /**
   * Loads the merchant, then reuses the same filter methods so every related
   * list stays in one place.
   */
  async getMerchantAggregatedData(merchantId: string): Promise<ApiResponse<MerchantAggregatedData>> {
    const merchant = await this.repository.findMerchant(merchantId);
    if (!merchant) {
      throw new HttpException(
        ResponseUtil.getErrorResponse('Merchant not found', HttpStatus.NOT_FOUND),
        HttpStatus.NOT_FOUND,
      );
    }
    const [stores, employees, subscriptions, roleTemplates, features] = await Promise.all([
      this.repository.getStores({ merchantId }),
      this.repository.getEmployees({ merchantId }),
      this.repository.getSubscriptions({ merchantId }),
      this.repository.getRoleTemplates({ merchantId }),
      this.repository.getFeatures({ merchantId }),
    ]);
    return ResponseUtil.getSuccessResponse('Merchant data loaded', {
      merchant,
      stores,
      employees,
      subscriptions,
      roleTemplates,
      features,
    });
  }
}
