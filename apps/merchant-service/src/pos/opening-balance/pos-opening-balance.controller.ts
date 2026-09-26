import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosOpeningBalanceDto } from './pos-opening-balance.dto';
import { PosOpeningBalanceService } from './pos-opening-balance.service';

const validate = new ValidationPipe({
  expectedType: SavePosOpeningBalanceDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/opening-balance',
  'connector/api/v1/stores/:storeId/pos/opening-balance',
  'stores/:storeId/pos/opening-balance',
])
export class PosOpeningBalanceController {
  constructor(@Inject(PosOpeningBalanceService) private readonly openingBalance: PosOpeningBalanceService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.openingBalance.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosOpeningBalanceDto) {
    return this.openingBalance.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosOpeningBalanceDto) {
    return this.openingBalance.update(storeId, body);
  }
}
