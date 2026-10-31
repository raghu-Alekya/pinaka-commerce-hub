import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PosRepository } from './pos.repository';
import { PosConfigRepository } from './pos-config.repository';
import { ShiftReportService } from './shift-report.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [PosRepository, PosConfigRepository, ShiftReportService],
})
export class AppModule {}
