import { Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, createParamDecorator, ExecutionContext, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
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

@Public()
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
  @Public()
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
  @Public()
  @Post(['login', 'store-emp-login', 'store_emp_login', 'employee-login'])
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: PosLoginDto,
    @CurrentDevice() device: DeviceContext,
  ) {
    return this.posAuthService.loginEmployee(dto, device);
  }

  /**
   * Store catalog: products, categories, and tags.
   * GET /api/v1/pos/auth/catalog
   * Requires the POS login access token plus x-merchant-id and x-store-id.
   */
  @Get('catalog')
  @HttpCode(HttpStatus.OK)
  async getStoreCatalog(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.posAuthService.getStoreCatalog(
      headerValue(authorization),
      headerValue(merchantId),
      headerValue(storeId),
    );
  }

  /**
   * Store products.
   * GET /api/v1/pos/auth/catalog/products
   * Requires the POS login access token plus x-merchant-id and x-store-id.
   */
  @Get(['catalog/products', 'products', 'store-products'])
  @HttpCode(HttpStatus.OK)
  async getStoreProducts(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.posAuthService.getStoreProducts(
      headerValue(authorization),
      headerValue(merchantId),
      headerValue(storeId),
    );
  }

  /**
   * Store categories.
   * GET /api/v1/pos/auth/catalog/categories
   * Requires the POS login access token plus x-merchant-id and x-store-id.
   */
  @Get(['catalog/categories', 'categories', 'store-categories'])
  @HttpCode(HttpStatus.OK)
  async getStoreCategories(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.posAuthService.getStoreCategories(
      headerValue(authorization),
      headerValue(merchantId),
      headerValue(storeId),
    );
  }

  /**
   * Distinct tags used by the store's products.
   * GET /api/v1/pos/auth/catalog/tags
   * Requires the POS login access token plus x-merchant-id and x-store-id.
   */
  @Get(['catalog/tags', 'tags', 'store-tags'])
  @HttpCode(HttpStatus.OK)
  async getStoreTags(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.posAuthService.getStoreTags(
      headerValue(authorization),
      headerValue(merchantId),
      headerValue(storeId),
    );
  }

  /**
   * All POS configurations for the store.
   * GET /api/v1/pos/auth/store-pos-configurations
   * Requires the POS login access token plus x-merchant-id and x-store-id.
   */
  @Get(['store-pos-configurations', 'configurations', 'pos-configurations'])
  @HttpCode(HttpStatus.OK)
  async getStorePosConfigurations(
    @Headers('authorization') authorization?: string,
    @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.posAuthService.getStorePosConfigurations(
      headerValue(authorization),
      headerValue(merchantId),
      headerValue(storeId),
    );
  }
}

function headerValue(value?: string | string[]): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}
