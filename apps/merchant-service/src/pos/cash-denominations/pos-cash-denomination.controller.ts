import { Body, Controller, Get, Inject, Param, Post, Put, Req, ValidationPipe } from '@nestjs/common';
import { requestOrigin } from '../../modules/store-pos-configuration/pos-configuration-image.service';
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
  get(@Param('storeId') storeId: string, @Req() request: Parameters<typeof requestOrigin>[0]) {
    return this.denominations.get(storeId, requestOrigin(request));
  }

  @Post()
  create(
    @Param('storeId') storeId: string,
    @Body(validate) body: SavePosCashDenominationDto,
    @Req() request: Parameters<typeof requestOrigin>[0],
  ) {
    return this.denominations.create(storeId, body, requestOrigin(request));
  }

  @Put()
  update(
    @Param('storeId') storeId: string,
    @Body(validate) body: SavePosCashDenominationDto,
    @Req() request: Parameters<typeof requestOrigin>[0],
  ) {
    return this.denominations.update(storeId, body, requestOrigin(request));
  }
}
