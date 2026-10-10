import { Module } from '@nestjs/common';
import { PosAuthController } from './controllers/pos-auth.controller';
import { PosAuthService } from './services/pos-auth.service';
import { PosSessionService } from './services/pos-session.service';
import { PinService } from './services/pin.service';

@Module({
  controllers: [PosAuthController],
  providers: [PosAuthService, PosSessionService, PinService],
  exports: [PosAuthService, PosSessionService],
})
export class PosAuthModule {}
