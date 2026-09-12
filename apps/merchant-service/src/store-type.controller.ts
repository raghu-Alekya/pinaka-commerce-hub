import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { CreateStoreTypeDto, UpdateStoreTypeDto } from './store-type.dto';

@Public()
@Controller('api/v1/store-types')
export class StoreTypeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async listStoreTypes(@Query('status') status?: string) {
    const storeTypes = await this.repository.listStoreTypes(status);
    return {
      success: true,
      count: storeTypes.length,
      storeTypes,
    };
  }

  @Get(':idOrCode')
  async getStoreType(@Param('idOrCode') idOrCode: string) {
    const storeType = await this.repository.getStoreTypeByIdOrCode(idOrCode);
    if (!storeType) {
      throw new NotFoundException(`Store type '${idOrCode}' not found`);
    }
    return {
      success: true,
      storeType,
    };
  }

  @Post()
  async createStoreType(@Body() body: CreateStoreTypeDto) {
    const existing = await this.repository.getStoreTypeByIdOrCode(body.storeTypeCode);
    if (existing) {
      throw new ConflictException(`Store type code '${body.storeTypeCode}' already exists`);
    }
    const storeType = await this.repository.createStoreType(body);
    return {
      success: true,
      message: 'Store vertical type created successfully',
      storeType,
    };
  }

  @Put(':idOrCode')
  async updateStoreType(@Param('idOrCode') idOrCode: string, @Body() body: UpdateStoreTypeDto) {
    const updated = await this.repository.updateStoreType(idOrCode, body);
    if (!updated) {
      throw new NotFoundException(`Store type '${idOrCode}' not found`);
    }
    return {
      success: true,
      message: 'Store vertical type updated successfully',
      storeType: updated,
    };
  }

  @Delete(':idOrCode')
  async deleteStoreType(@Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteStoreType(idOrCode);
    if (!deleted) {
      throw new NotFoundException(`Store type '${idOrCode}' not found`);
    }
    return {
      success: true,
      message: 'Store vertical type deleted / deactivated successfully',
    };
  }
}
