import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
