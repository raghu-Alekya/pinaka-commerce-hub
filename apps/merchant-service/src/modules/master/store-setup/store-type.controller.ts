import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { CreateStoreTypeDto, UpdateStoreTypeDto } from './store-type.dto';
import { StoreTypeRepository } from './store-type.repository';
import { MasterFormValidationPipe } from '../common/master-form.pipe';
import { filterMasterList } from '../common/master-list';
import { RequireAuth } from '../../shared/session-auth.guard';

const bodyValidation = new MasterFormValidationPipe({
  transform: true,
  whitelist: false,
  forbidNonWhitelisted: false,
  skipUndefinedProperties: true,
  expectedType: CreateStoreTypeDto,
});
const patchValidation = new MasterFormValidationPipe({
  transform: true,
  whitelist: false,
  forbidNonWhitelisted: false,
  skipUndefinedProperties: true,
  expectedType: UpdateStoreTypeDto,
});

type AuthenticatedRequest = { user?: { id?: string } };

@Public()
@Controller([
  'api/v1/store-types',
  'api/v1/store_types',
  'connector/api/v1/store-types',
  'connector/api/v1/store_types',
  'store-types',
  'store_types',
])
export class StoreTypeController {
  constructor(@Inject(StoreTypeRepository) private readonly repository: StoreTypeRepository) {}

  @Get()
  async listStoreTypes(@Query() query: Record<string, string>) {
    const storeTypes = filterMasterList(await this.repository.list(), query);
    const nextStoreTypeCode = await this.repository.previewNextCode();
    return { success: true, count: storeTypes.length, nextStoreTypeCode, storeTypes };
  }

  @Get(':idOrCode')
  async getStoreType(@Param('idOrCode') idOrCode: string) {
    const storeType = await this.repository.findByIdOrCode(idOrCode);
    if (!storeType) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, storeType };
  }

  @Post()
  @RequireAuth()
  async createStoreType(
    @Body(bodyValidation) body: CreateStoreTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const storeType = await this.repository.create(body, this.loginUserId(request));
    return { success: true, message: 'Store type created successfully', storeType };
  }

  @Put(':idOrCode')
  @RequireAuth()
  async replaceStoreType(
    @Param('idOrCode') idOrCode: string,
    @Body(bodyValidation) body: CreateStoreTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.repository.update(idOrCode, {
      name: body.name,
      description: body.description,
      status: body.status,
    }, this.loginUserId(request));
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, message: 'Store type updated successfully', storeType: updated };
  }

  @Patch(':idOrCode')
  @RequireAuth()
  async patchStoreType(
    @Param('idOrCode') idOrCode: string,
    @Body(patchValidation) body: UpdateStoreTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.repository.update(idOrCode, body, this.loginUserId(request));
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, message: 'Store type updated successfully', storeType: updated };
  }

  @Put(':idOrCode/status')
  @RequireAuth()
  async replaceStatus(
    @Param('idOrCode') idOrCode: string,
    @Body(patchValidation) body: UpdateStoreTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.patchStatus(idOrCode, body, request);
  }

  @Patch(':idOrCode/status')
  @RequireAuth()
  async patchStatus(
    @Param('idOrCode') idOrCode: string,
    @Body(patchValidation) body: UpdateStoreTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!body.status) throw new BadRequestException('status is required');
    const updated = await this.repository.update(
      idOrCode,
      { status: body.status },
      this.loginUserId(request),
    );
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return {
      success: true,
      message: `Store type status updated to ${updated.status}`,
      storeType: updated,
    };
  }

  @Delete(':idOrCode')
  @RequireAuth()
  async deleteStoreType(
    @Param('idOrCode') idOrCode: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const storeType = await this.repository.deactivate(idOrCode, this.loginUserId(request));
    if (!storeType) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return {
      success: true,
      message: 'Store type deactivated successfully',
      isDeleted: true,
      storeType,
    };
  }

  @Post('dummy-test')
  async dummyCreateOrUpdate(@Body() body: any) {
    return {
      success: true,
      message: 'Dummy create/update method executed successfully',
      method: 'POST',
      receivedData: body,
      timestamp: new Date().toISOString(),
    };
  }

  private loginUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.id;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId || '');
    if (!isUuid) {
      throw new UnauthorizedException('Authenticated user UUID is required for audit fields');
    }
    return userId!;
  }
}
