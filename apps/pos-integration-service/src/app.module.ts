import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PosRepository } from './pos.repository';
import { PosConfigRepository } from './pos-config.repository';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [PosRepository, PosConfigRepository],
})
export class AppModule {}
