import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { StoreSetupModule } from '../master/store-setup/store-setup.module';
import { MerchantModule } from '../merchant/merchant.module';

@Module({
  imports: [MerchantModule, StoreSetupModule],
  controllers: [AppController],
})
export class StoreModule {}
