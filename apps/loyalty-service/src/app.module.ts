import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { CouponsModule } from './coupons/coupons.module';

@Module({
  imports: [CouponsModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
