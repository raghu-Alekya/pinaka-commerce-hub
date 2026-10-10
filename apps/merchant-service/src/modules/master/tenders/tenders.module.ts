import { Module } from '@nestjs/common';
import { MerchantTendorController } from './merchant-tendor.controller';
import { TendorController } from './tendor.controller';
import { TendorRepository } from './tendor.repository';
import { MerchantModule } from '../../merchant/merchant.module';
import { RelationshipsModule } from '../../shared/relationships.module';

@Module({
  imports: [MerchantModule, RelationshipsModule],
  controllers: [TendorController, MerchantTendorController],
  providers: [TendorRepository],
  exports: [TendorRepository],
})
export class TendersModule {}
