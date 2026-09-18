import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { FeatureAccessRepository } from './feature-access.repository';

@Controller('api/v1/merchants/:merchantId/stores/:storeId/features/:featureId/access')
export class FeatureAccessController {
  constructor(@Inject(FeatureAccessRepository) private readonly repository: FeatureAccessRepository) {}

  @Get()
  get(
    @Param('merchantId') merchantId: string,
    @Param('storeId') storeId: string,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
  ) {
    return this.repository.resolve(merchantId, storeId, featureId);
  }
}
