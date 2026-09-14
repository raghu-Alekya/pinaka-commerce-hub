import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { CreateFeatureDto, UpdateFeatureDto } from './feature.dto';

@Public()
@Controller('api/v1/features')
export class FeatureController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Query('status') status?: string, @Query('category') category?: string) {
    const features = await this.repository.listFeatures(status, category);
    return { success: true, count: features.length, features };
  }

  @Get(':idOrKey')
  async get(@Param('idOrKey') idOrKey: string) {
    const feature = await this.repository.getFeatureByIdOrKey(idOrKey);
    if (!feature) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return { success: true, feature };
  }

  @Post()
  async create(@Body() body: CreateFeatureDto) {
    const existing = await this.repository.getFeatureByIdOrKey(body.featureKey);
    if (existing) throw new ConflictException(`Feature key '${body.featureKey}' already exists`);
    const feature = await this.repository.createFeature(body);
    return { success: true, message: 'Feature created successfully', feature };
  }

  @Put(':idOrKey')
  async update(@Param('idOrKey') idOrKey: string, @Body() body: UpdateFeatureDto) {
    const updated = await this.repository.updateFeature(idOrKey, body);
    if (!updated) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return { success: true, message: 'Feature updated successfully', feature: updated };
  }

  @Delete(':idOrKey')
  async delete(@Param('idOrKey') idOrKey: string) {
    const deleted = await this.repository.deleteFeature(idOrKey);
    if (!deleted) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return { success: true, message: 'Feature deactivated successfully' };
  }
}
