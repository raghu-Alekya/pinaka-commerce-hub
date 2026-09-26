import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosCurrencyTaxDto } from './pos-currency-tax.dto';
import { PosCurrencyTaxService } from './pos-currency-tax.service';

const validate = new ValidationPipe({
  expectedType: SavePosCurrencyTaxDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/currency-tax',
  'connector/api/v1/stores/:storeId/pos/currency-tax',
  'stores/:storeId/pos/currency-tax',
])
export class PosCurrencyTaxController {
  constructor(@Inject(PosCurrencyTaxService) private readonly currencyTax: PosCurrencyTaxService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.currencyTax.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosCurrencyTaxDto) {
    return this.currencyTax.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosCurrencyTaxDto) {
    return this.currencyTax.update(storeId, body);
  }
}
