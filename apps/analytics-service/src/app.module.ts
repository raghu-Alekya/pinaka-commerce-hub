import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AnalyticsRepository } from './analytics.repository';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports';

@Module({
  imports: [],
  controllers: [AppController, SalesReportsController],
  providers: [AnalyticsRepository, SalesReportsService],
})
export class AppModule {}
