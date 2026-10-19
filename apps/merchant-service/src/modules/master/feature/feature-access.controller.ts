import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { FeatureAccessRepository } from './feature-access.repository';

const snakeCaseResponse = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(snakeCaseResponse);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), snakeCaseResponse(item),
  ]));
};

@Controller('api/v1/merchants/:merchant_id/stores/:store_id/features/:feature_id/access')
export class FeatureAccessController {
  constructor(@Inject(FeatureAccessRepository) private readonly repository: FeatureAccessRepository) {}

  @Get()
  async get(
    @Param('merchant_id') merchantId: string,
    @Param('store_id') storeId: string,
    @Param('feature_id', new ParseUUIDPipe()) featureId: string,
  ) {
    return snakeCaseResponse(await this.repository.resolve(merchantId, storeId, featureId));
  }
}
