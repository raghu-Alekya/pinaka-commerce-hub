import { Controller, Post, Body, HttpCode, HttpStatus, createParamDecorator, ExecutionContext, Inject } from '@nestjs/common';
import { PosAuthService, DeviceContext } from '../services/pos-auth.service';
import { MerchantStoreLoginDto } from '../dto/merchant-store-login.dto';
import { PosLoginDto } from '../dto/pos-login.dto';

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.device || {
      deviceId: request.headers['x-device-id'] || '',
      merchantId: request.headers['x-merchant-id'] || '',
      storeId: request.headers['x-store-id'] || '',
      registerId: request.headers['x-register-id'] || '',
      status: 'ACTIVE',
    };
  },
);

@Controller(['api/v1/pos/auth', 'connector/api/v1/pos/auth', 'api/v1/auth', 'connector/api/v1/auth', 'pos/auth', 'auth'])
export class PosAuthController {
  constructor(
    @Inject(PosAuthService) private readonly posAuthService: PosAuthService,
  ) {}

  /**
   * API 1: Merchant & Store Login / Information Lookup
   * POST /api/v1/pos/auth/merchant-store-login
   * Public endpoint - No Bearer token required in headers
   */
  @Post(['merchant-store-login', 'merchant_store_login'])
  @HttpCode(HttpStatus.OK)
  async merchantStoreLogin(@Body() dto: MerchantStoreLoginDto) {
    return this.posAuthService.merchantStoreLogin(dto);
  }

  /**
   * API 2: Employee PIN Login (POS Authentication - 6-digit PIN)
   * POST /api/v1/pos/auth/login
   * POST /api/v1/pos/auth/store-emp-login
   * Public endpoint - No Bearer token required in headers
   */
  @Post(['login', 'store-emp-login', 'store_emp_login', 'employee-login'])
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: PosLoginDto,
    @CurrentDevice() device: DeviceContext,
  ) {
    return this.posAuthService.loginEmployee(dto, device);
  }
}
