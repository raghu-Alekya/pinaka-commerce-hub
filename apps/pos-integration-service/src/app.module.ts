import { Module } from '@nestjs/common';
import { AppController, PosVendorPaymentController } from './app.controller';
import { PosRepository } from './pos.repository';
import { PosConfigRepository } from './pos-config.repository';
import { ShiftReportService } from './shift-report.service';

@Module({
  imports: [],
  controllers: [AppController, PosVendorPaymentController],
  providers: [PosRepository, PosConfigRepository, ShiftReportService],
})
export class AppModule {}
