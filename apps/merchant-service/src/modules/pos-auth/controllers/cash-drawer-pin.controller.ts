import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { PosAuthService } from '../services/pos-auth.service';

@Public()
@Controller(['api/v1', 'connector/api/v1', 'pinaka-pos/v1', 'wp-json/pinaka-pos/v1'])
export class CashDrawerPinController {
  constructor(@Inject(PosAuthService) private readonly auth: PosAuthService) {}

  @Post('token/cashdrawer-access')
  @HttpCode(HttpStatus.OK)
  validate(
    @Body() body: { emp_login_pin?: unknown },
    @Headers('authorization') authorization?: string,
  ) {
    return this.auth.validateCashDrawerPin(body?.emp_login_pin, authorization);
  }
}
