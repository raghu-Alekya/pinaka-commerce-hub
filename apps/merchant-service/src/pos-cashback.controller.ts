import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosCashbackDto } from './pos-cashback.dto';
import { PosCashbackService } from './pos-cashback.service';

const validate = new ValidationPipe({
  expectedType: SavePosCashbackDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/cashback',
  'connector/api/v1/stores/:storeId/pos/cashback',
  'stores/:storeId/pos/cashback',
])
export class PosCashbackController {
  constructor(@Inject(PosCashbackService) private readonly cashback: PosCashbackService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.cashback.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashbackDto) {
    return this.cashback.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashbackDto) {
    return this.cashback.update(storeId, body);
  }
}
