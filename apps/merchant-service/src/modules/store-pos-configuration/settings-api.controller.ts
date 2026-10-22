import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RequireAuth } from '../shared/session-auth.guard';
import {
  BusinessInfoDto, CashSettingsDto, DeviceSettingsDto, EnableCashbackDto,
  EnableCouponsDto, EnableLoyaltyPointsDto, EnableSafesDropDto, EnableSafesDto,
  EnableServiceChargeDto, EnableTaxesDto, GeneralSettingsDto, SequentialCouponsDto,
} from './dto/settings-api.dto';
import { SettingsScope } from './settings-api.repository';
import { SettingsApiService } from './settings-api.service';

type AuthenticatedRequest = {
  user?: { id?: string; merchantId?: string; storeId?: string };
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
  get(name: string): string | undefined;
};
type UploadedSettingsImage = { buffer: Buffer; mimetype: string };
type SettingsImageFiles = { image_upload?: UploadedSettingsImage[]; logo_upload?: UploadedSettingsImage[] };

const settingsImageDirectory = join(process.cwd(), 'uploads', 'settings');
mkdirSync(settingsImageDirectory, { recursive: true });
const { memoryStorage } = require('multer');
const settingsImageUpload = FileFieldsInterceptor([
  { name: 'image_upload', maxCount: 1 },
  { name: 'logo_upload', maxCount: 1 },
], {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_request: unknown, file: UploadedSettingsImage,
    callback: (error: Error | null, accept: boolean) => void) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    callback(allowed ? null : new BadRequestException('Settings images must be JPG, PNG, WebP, or GIF'), allowed);
  },
});

@RequireAuth()
@Controller(['api/v1/settings', 'connector/api/v1/settings', 'pinaka-pos/v1/settings', 'wp-json/pinaka-pos/v1/settings'])
export class SettingsApiController {
  constructor(@Inject(SettingsApiService) private readonly settings: SettingsApiService) {}

  @Post('general-settings') @HttpCode(HttpStatus.OK) @UseInterceptors(settingsImageUpload)
  async general(@Body() body: GeneralSettingsDto, @Req() request: AuthenticatedRequest,
    @UploadedFiles() files?: SettingsImageFiles, @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string) {
    const savedPaths: string[] = [];
    try {
      const image = files?.image_upload?.[0];
      const logo = files?.logo_upload?.[0];
      if (image) body.image_url = await this.saveImage(image, request, savedPaths);
      if (logo) body.logo_url = await this.saveImage(logo, request, savedPaths);
      return await this.settings.general(body, this.scope(request, merchantId, storeId));
    } catch (error) {
      await Promise.all(savedPaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }
  }

  @Get('general-settings')
  getGeneral(@Req() request: AuthenticatedRequest, @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string) {
    return this.settings.getGeneral(this.scope(request, merchantId, storeId));
  }

  @Post('device-settings') @HttpCode(HttpStatus.OK)
  device(@Body() body: DeviceSettingsDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.device(body, this.scope(request, merchantId, storeId));
  }

  @Get('device-settings')
  getDevice(@Req() request: AuthenticatedRequest, @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string) {
    return this.settings.getDevice(this.scope(request, merchantId, storeId));
  }

  @Get('cash-settings')
  cash(@Req() request: AuthenticatedRequest, @Headers('x-merchant-id') merchantId?: string,
    @Headers('x-store-id') storeId?: string) {
    return this.settings.cash(this.scope(request, merchantId, storeId));
  }

  @Post('cash-settings') @HttpCode(HttpStatus.OK)
  saveCash(@Body() body: CashSettingsDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.saveCash(body, this.scope(request, merchantId, storeId));
  }

  @Post('business-info') @HttpCode(HttpStatus.OK)
  business(@Body() body: BusinessInfoDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.business(body, this.scope(request, merchantId, storeId));
  }

  @Post('enable-taxes') @HttpCode(HttpStatus.OK)
  taxes(@Body() body: EnableTaxesDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_taxes', body.enable_taxes, this.scope(request, merchantId, storeId));
  }

  @Post('enable-coupons') @HttpCode(HttpStatus.OK)
  coupons(@Body() body: EnableCouponsDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_coupons', body.enable_coupons, this.scope(request, merchantId, storeId));
  }

  @Post('sequential-coupons') @HttpCode(HttpStatus.OK)
  sequential(@Body() body: SequentialCouponsDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('coupon_sequential', body.coupon_sequential, this.scope(request, merchantId, storeId));
  }

  @Post('enable-safes') @HttpCode(HttpStatus.OK)
  safes(@Body() body: EnableSafesDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_safes', body.enable_safes, this.scope(request, merchantId, storeId));
  }

  @Post('enable-safes-drop') @HttpCode(HttpStatus.OK)
  safeDrop(@Body() body: EnableSafesDropDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_safes_drop', body.enable_safes_drop, this.scope(request, merchantId, storeId));
  }

  @Post('enable-cashback') @HttpCode(HttpStatus.OK)
  cashback(@Body() body: EnableCashbackDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_cashback', body.enable_cashback, this.scope(request, merchantId, storeId));
  }

  @Post('enable-service-charge') @HttpCode(HttpStatus.OK)
  serviceCharge(@Body() body: EnableServiceChargeDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_service_charge', body.enable_service_charge, this.scope(request, merchantId, storeId));
  }

  @Post('enable-loyalty-points') @HttpCode(HttpStatus.OK)
  loyalty(@Body() body: EnableLoyaltyPointsDto, @Req() request: AuthenticatedRequest,
    @Headers('x-merchant-id') merchantId?: string, @Headers('x-store-id') storeId?: string) {
    return this.settings.toggle('enable_loyalty_points', body.enable_loyalty_points,
      this.scope(request, merchantId, storeId), true);
  }

  private scope(request: AuthenticatedRequest, merchantHeader?: string, storeHeader?: string): SettingsScope {
    return { user: request.user, merchantHeader, storeHeader };
  }

  private async saveImage(file: UploadedSettingsImage, request: AuthenticatedRequest, savedPaths: string[]): Promise<string> {
    const extension = file.mimetype === 'image/png' ? '.png'
      : file.mimetype === 'image/webp' ? '.webp' : file.mimetype === 'image/gif' ? '.gif' : '.jpg';
    const filename = `${randomUUID()}${extension}`;
    const diskPath = join(settingsImageDirectory, filename);
    await writeFile(diskPath, file.buffer);
    savedPaths.push(diskPath);
    return `${this.requestOrigin(request)}/uploads/settings/${filename}`;
  }

  private requestOrigin(request: AuthenticatedRequest): string {
    const forwardedProtocol = request.headers?.['x-forwarded-proto'];
    const forwardedHost = request.headers?.['x-forwarded-host'];
    const protocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)?.split(',')[0]?.trim()
      || request.protocol || 'http';
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
      || request.get('host') || 'localhost:3003';
    return `${protocol}://${host}`;
  }
}
