import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { RelationshipOwnerGuard } from '../../shared/relationships.controller';

@Controller('api/v1/merchants/:merchantId/store-types/:storeTypeId/features')
@UseGuards(RelationshipOwnerGuard)
export class MerchantPlanFeaturesController {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  @Get()
  get(@Param('merchantId') merchantId: string, @Param('storeTypeId') storeTypeId: string) {
    return this.merchants.getSubscribedFeatures(merchantId, storeTypeId);
  }
}
