import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MenuRepository } from './menu.repository';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [MenuRepository],
})
export class AppModule {}
