import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosCashRegisterDto } from './pos-cash-register.dto';
import { PosCashRegisterService } from './pos-cash-register.service';

const validate = new ValidationPipe({
  expectedType: SavePosCashRegisterDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/cash-registers',
  'connector/api/v1/stores/:storeId/pos/cash-registers',
  'stores/:storeId/pos/cash-registers',
])
export class PosCashRegisterController {
  constructor(@Inject(PosCashRegisterService) private readonly cashRegisters: PosCashRegisterService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.cashRegisters.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashRegisterDto) {
    return this.cashRegisters.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosCashRegisterDto) {
    return this.cashRegisters.update(storeId, body);
  }
}
