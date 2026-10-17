import { Module } from '@nestjs/common';
import { DynamicQueryController } from './dynamic-query.controller';
import { DynamicQueryRepository } from './dynamic-query.repository';
import { DynamicQueryService } from './dynamic-query.service';
import { MerchantModule } from '../merchant/merchant.module';

@Module({
  imports: [MerchantModule],
  controllers: [DynamicQueryController],
  providers: [DynamicQueryRepository, DynamicQueryService],
})
export class DynamicQueryModule {}
