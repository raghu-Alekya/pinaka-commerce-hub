import { Module } from '@nestjs/common';
import { PosAuthController } from './controllers/pos-auth.controller';
import { PosAuthService } from './services/pos-auth.service';
import { PosSessionService } from './services/pos-session.service';
import { PinService } from './services/pin.service';
import { MerchantModule } from '../merchant/merchant.module';
import { RefundValidUserController } from './controllers/refund-valid-user.controller';
import { ProductOptionsService } from '../store/product-options.service';

@Module({
  imports: [MerchantModule],
  controllers: [PosAuthController, RefundValidUserController],
  providers: [PosAuthService, PosSessionService, PinService, ProductOptionsService],
  exports: [PosAuthService, PosSessionService],
})
export class PosAuthModule {}
