import { Controller, Get } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { COUNTRIES } from './countries';

@Public()
@Controller(['api/v1/countries', 'connector/api/v1/countries', 'countries'])
export class CountriesController {
  @Get()
  list() {
    return { success: true, count: COUNTRIES.length, countries: COUNTRIES };
  }
}
