import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosServiceChargeDto } from './pos-service-charge.dto';
import { PosServiceChargeService } from './pos-service-charge.service';

const validate = new ValidationPipe({
  expectedType: SavePosServiceChargeDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/service-charges',
  'connector/api/v1/stores/:storeId/pos/service-charges',
  'stores/:storeId/pos/service-charges',
])
export class PosServiceChargeController {
  constructor(@Inject(PosServiceChargeService) private readonly serviceCharges: PosServiceChargeService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.serviceCharges.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosServiceChargeDto) {
    return this.serviceCharges.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosServiceChargeDto) {
    return this.serviceCharges.update(storeId, body);
  }
}
