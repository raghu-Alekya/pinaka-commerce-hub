import { Module } from '@nestjs/common';
import { FeatureAccessController } from './feature-access.controller';
import { FeatureAccessRepository } from './feature-access.repository';
import { FeatureController as LegacyFeatureController } from '../../master/common/master-data.controller';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [
    LegacyFeatureController,
    FeatureAccessController,
  ],
  providers: [FeatureAccessRepository],
  exports: [FeatureAccessRepository],
})
export class FeatureModule {}
