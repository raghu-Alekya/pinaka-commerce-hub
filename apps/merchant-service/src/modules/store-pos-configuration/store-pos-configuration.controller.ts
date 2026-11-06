import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { requestOrigin } from './pos-configuration-image.service';
import { StorePosConfigurationsService } from './store-pos-configuration.service';
import { CreateStorePosConfigurationDto } from './dto/create-store-pos-configuration.dto';
import { UpdateStorePosConfigurationDto } from './dto/update-store-pos-configuration.dto';
import { UploadedPosIcon } from './pos-configuration-image.service';

type IconRequest = {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { id?: string };
  get(name: string): string | undefined;
};

const { memoryStorage } = require('multer');
const storeIconUpload = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (
    _request: unknown,
    file: { mimetype: string },
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    callback(allowed ? null : new BadRequestException('Icon image must be PNG, JPG, or WEBP'), allowed);
  },
});

@Controller([
  'api/v1/store/store-pos-configuration',
  'connector/api/v1/store/store-pos-configuration',
  'store/store-pos-configuration',
])
export class StorePosConfigurationController {
  constructor(
    @Inject(StorePosConfigurationsService)
    private readonly service: StorePosConfigurationsService,
  ) {}

  /**
   * Create a new store POS configuration.
   *
   * POST /api/v1/store/store-pos-configuration
   */
  @Post()
  create(
    @Body() dto: CreateStorePosConfigurationDto,
    @Req() request: IconRequest,
  ) {
    return this.service.create(dto, request.user?.id, requestOrigin(request));
  }
  /**
   * Store a POS icon in this merchant store's images folder.
   *
   * POST /api/v1/store/store-pos-configuration/:storeId/images
   */
  @Post(':storeId/images')
  @HttpCode(201)
  @UseInterceptors(storeIconUpload)
  uploadIcon(
    @Param('storeId') storeId: string,
    @UploadedFile() file: UploadedPosIcon | undefined,
    @Req() request: IconRequest,
  ) {
    return this.service.saveStoreIcon(storeId, file, requestOrigin(request));
  }

  /**
   * Create or update a store POS configuration.
   *
   * PUT /api/v1/store/store-pos-configuration
   */
  @Put()
  upsert(
    @Body() dto: CreateStorePosConfigurationDto,
    @Req() request: IconRequest,
  ) {
    return this.service.upsert(dto, request.user?.id, requestOrigin(request));
  }

  /**
   * Get all POS configurations for a store.
   *
   * GET /api/v1/store/store-pos-configuration/:storeId
   */
  @Get(':storeId')
  findByStore(
    @Param('storeId') storeId: string,
    @Req() request: IconRequest,
  ) {
    return this.service.findByStoreId(storeId, requestOrigin(request));
  }

  /**
   * POS terminal asset payload. Denomination icons are URLs under this
   * store's /uploads/{merchant}/{store}/images folder.
   *
   * GET /api/v1/store/store-pos-configuration/:storeId/bootstrap
   */
  @Get(':storeId/bootstrap')
  getStoreBootstrap(@Param('storeId') storeId: string, @Req() request: IconRequest) {
    return this.service.getStoreInfo(storeId, requestOrigin(request));
  }
  /**
   * Get a specific POS configuration.
   *
   * GET /api/v1/store/store-pos-configuration/:storeId/:configurationName
   */
  @Get(':storeId/:configurationName')
  findOne(
    @Param('storeId') storeId: string,
    @Param('configurationName') configurationName: string,
    @Req() request: IconRequest,
  ) {
    return this.service.findPresented(
      storeId,
      configurationName,
      requestOrigin(request),
    );
  }

  /**
   * Get only the JSON configuration value.
   *
   * GET /api/v1/store/store-pos-configuration/:storeId/:configurationName/value
   */
  @Get(':storeId/:configurationName/value')
  getValue(
    @Param('storeId') storeId: string,
    @Param('configurationName') configurationName: string,
    @Req() request: IconRequest,
  ) {
    return this.service.getConfigurationValue(
      storeId,
      configurationName,
      requestOrigin(request),
    );
  }

  /**
   * Update a specific POS configuration.
   *
   * PATCH /api/v1/store/store-pos-configuration/:storeId/:configurationName
   */
  @Patch(':storeId/:configurationName')
  update(
    @Param('storeId') storeId: string,
    @Param('configurationName') configurationName: string,
    @Body() dto: UpdateStorePosConfigurationDto,
    @Req() request: IconRequest,
  ) {
    return this.service.update(
      storeId,
      configurationName,
      dto,
      request.user?.id,
      requestOrigin(request),
    );
  }

  /**
   * Delete a specific POS configuration.
   *
   * DELETE /api/v1/store/store-pos-configuration/:storeId/:configurationName
   */
  @Delete(':storeId/:configurationName')
  async remove(
    @Param('storeId') storeId: string,
    @Param('configurationName') configurationName: string,
  ) {
    await this.service.remove(
      storeId,
      configurationName,
    );

    return {
      success: true,
      message: 'POS configuration deleted successfully',
    };
  } 
}