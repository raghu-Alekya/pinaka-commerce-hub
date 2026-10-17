import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { RequireAuth } from '../../shared/session-auth.guard';
import { CreateStoreDeviceMappingDto } from './dto/create-store-device-mapping.dto';
import { StoreDeviceMappingService } from './store-device-mapping.service';

type AuthenticatedRequest = { user?: { id?: string } };

// Keep this outside /store-pos-configuration/:storeId so the generic POS
// configuration GET route cannot capture "device-mappings" as a store ID.
@Controller('api/v1/store-device-mappings')
export class StoreDeviceMappingController {
  constructor(@Inject(StoreDeviceMappingService) private readonly service: StoreDeviceMappingService) {}

  @Post()
  @RequireAuth()
  map(
    @Body(new ValidationPipe({
      expectedType: CreateStoreDeviceMappingDto,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })) dto: CreateStoreDeviceMappingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.map(dto, this.actorId(request));
  }

  @Get()
  findByStore(@Query('store_id') storeId?: string) {
    if (!storeId?.trim()) throw new BadRequestException('store_id query parameter is required');
    return this.service.findByStore(storeId.trim());
  }

  @Delete(':id')
  @RequireAuth()
  unmap(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.unmap(id, this.actorId(request));
  }

  private actorId(request: AuthenticatedRequest): string {
    if (!request.user?.id) throw new UnauthorizedException('Authenticated user UUID is unavailable');
    return request.user.id;
  }
}
