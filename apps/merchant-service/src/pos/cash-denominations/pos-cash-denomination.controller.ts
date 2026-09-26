import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosCashDenominationDto } from './pos-cash-denomination.dto';
import { PosCashDenominationService } from './pos-cash-denomination.service';

const validate = new ValidationPipe({
  expectedType: SavePosCashDenominationDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/cash-denominations',
  'connector/api/v1/stores/:storeId/pos/cash-denominations',
  'stores/:storeId/pos/cash-denominations',
])
export class PosCashDenominationController {
  constructor(@Inject(PosCashDenominationService) private readonly denominations: PosCashDenominationService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.denominations.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashDenominationDto) {
    return this.denominations.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashDenominationDto) {
    return this.denominations.update(storeId, body);
  }
}
