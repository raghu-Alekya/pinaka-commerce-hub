import { ArgumentMetadata, Body, Controller, Get, Inject, Param, Post, Put, Req, ValidationPipe } from '@nestjs/common';
import { requestOrigin } from '../../modules/store-pos-configuration/pos-configuration-image.service';
import { RequireAuth } from '../../modules/shared/session-auth.guard';
import { SavePosSafeDropDto } from './pos-safe-drop.dto';
import { PosSafeDropService } from './pos-safe-drop.service';

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
    result[camelKey] = camelizeKeys(child);
  }
  return result;
}

class SafeDropValidationPipe extends ValidationPipe {
  constructor() {
    super({
      expectedType: SavePosSafeDropDto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(camelizeKeys(value), metadata);
  }
}

const validate = new SafeDropValidationPipe();

@Controller([
  'api/v1/stores/:storeId/pos/safe-drop',
  'connector/api/v1/stores/:storeId/pos/safe-drop',
  'stores/:storeId/pos/safe-drop',
])
export class PosSafeDropController {
  constructor(@Inject(PosSafeDropService) private readonly safeDrop: PosSafeDropService) {}

  @Get()
  get(@Param('storeId') storeId: string, @Req() request: Parameters<typeof requestOrigin>[0]) {
    return this.safeDrop.get(storeId, requestOrigin(request));
  }

  @Get('status')
  @RequireAuth()
  getStatus(
    @Param('storeId') storeId: string,
    @Req() request: { user?: { id?: string; accountId?: string; merchantId?: string; storeId?: string } },
  ) {
    return this.safeDrop.getStatus(storeId, request.user);
  }

  @Post()
  create(
    @Param('storeId') storeId: string,
    @Body(validate) body: SavePosSafeDropDto,
    @Req() request: Parameters<typeof requestOrigin>[0],
  ) {
    return this.safeDrop.create(storeId, body, requestOrigin(request));
  }

  @Put()
  update(
    @Param('storeId') storeId: string,
    @Body(validate) body: SavePosSafeDropDto,
    @Req() request: Parameters<typeof requestOrigin>[0],
  ) {
    return this.safeDrop.update(storeId, body, requestOrigin(request));
  }
}
