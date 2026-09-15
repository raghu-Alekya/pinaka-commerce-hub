import {
  BadRequestException,
  Body,
  ConflictException,
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
  ValidationPipe,
} from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { CreateStoreTypeDto, UpdateStoreTypeDto } from './store-type.dto';
import { StoreTypeStatus } from './entities/store-type.entity';

const bodyValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  expectedType: CreateStoreTypeDto,
});
const patchValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  skipUndefinedProperties: true,
  expectedType: UpdateStoreTypeDto,
});

@Controller(['api/v1/store-types', 'api/v1/store_types'])
export class StoreTypeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async listStoreTypes(@Query('status') status?: string) {
    const storeTypes = await this.repository.listStoreTypes(status);
    return { success: true, count: storeTypes.length, storeTypes };
  }

  @Get(':idOrCode')
  async getStoreType(@Param('idOrCode') idOrCode: string) {
    const storeType = await this.repository.getStoreTypeByIdOrCode(idOrCode);
    if (!storeType) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, storeType };
  }

  @Post()
  async createStoreType(@Body(bodyValidation) body: CreateStoreTypeDto) {
    const existing = await this.repository.getStoreTypeByIdOrCode(body.storeTypeCode);
    if (existing) {
      throw new ConflictException(`Store type code '${body.storeTypeCode}' already exists`);
    }
    const storeType = await this.repository.createStoreType(body);
    return { success: true, message: 'Store type saved to PostgreSQL', storeType };
  }

  @Put(':idOrCode')
  async replaceStoreType(@Param('idOrCode') idOrCode: string, @Body(bodyValidation) body: CreateStoreTypeDto) {
    const updated = await this.repository.updateStoreType(idOrCode, {
      name: body.name,
      description: body.description,
      status: body.status,
    });
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, message: 'Store type updated in PostgreSQL', storeType: updated };
  }

  @Patch(':idOrCode')
  async patchStoreType(@Param('idOrCode') idOrCode: string, @Body(patchValidation) body: UpdateStoreTypeDto) {
    const updated = await this.repository.updateStoreType(idOrCode, body);
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, message: 'Store type updated in PostgreSQL', storeType: updated };
  }

  @Put(':idOrCode/status')
  async replaceStatus(@Param('idOrCode') idOrCode: string, @Body(patchValidation) body: UpdateStoreTypeDto) {
    return this.patchStatus(idOrCode, body);
  }

  @Patch(':idOrCode/status')
  async patchStatus(@Param('idOrCode') idOrCode: string, @Body(patchValidation) body: UpdateStoreTypeDto) {
    if (!body.status) throw new BadRequestException('status is required');
    const updated = await this.repository.updateStoreType(idOrCode, { status: body.status });
    if (!updated) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return {
      success: true,
      message: `Store type status updated to ${updated.status}`,
      storeType: updated,
    };
  }

  @Delete(':idOrCode')
  async deleteStoreType(@Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteStoreType(idOrCode);
    if (!deleted) throw new NotFoundException(`Store type '${idOrCode}' not found`);
    return { success: true, message: 'Store type deactivated in PostgreSQL', status: StoreTypeStatus.INACTIVE };
  }

  @Post('dummy')
  async dummyCreateOrUpdate(@Body() body: any) {
    return {
      success: true,
      message: 'Dummy create/update method executed successfully',
      method: 'POST',
      receivedData: body,
      timestamp: new Date().toISOString(),
    };
  }
}
