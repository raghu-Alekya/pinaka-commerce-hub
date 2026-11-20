import { Module } from '@nestjs/common';
import { OrderPersistenceModule } from '../order-persistence.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyRepository } from './loyalty.repository';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [OrderPersistenceModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyRepository, LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
