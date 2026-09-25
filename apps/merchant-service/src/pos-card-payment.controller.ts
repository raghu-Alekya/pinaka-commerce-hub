import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosCardPaymentDto } from './pos-card-payment.dto';
import { PosCardPaymentService } from './pos-card-payment.service';

const validate = new ValidationPipe({
  expectedType: SavePosCardPaymentDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/card-payments',
  'connector/api/v1/stores/:storeId/pos/card-payments',
  'stores/:storeId/pos/card-payments',
])
export class PosCardPaymentController {
  constructor(@Inject(PosCardPaymentService) private readonly cardPayments: PosCardPaymentService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.cardPayments.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosCardPaymentDto) {
    return this.cardPayments.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosCardPaymentDto) {
    return this.cardPayments.update(storeId, body);
  }
}
