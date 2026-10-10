import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { Public } from "@pinaka-delivery-hub/auth";
import { MerchantRepository } from "../../merchant/merchant.repository";
import { CreateFeatureDto, UpdateFeatureDto } from "./feature.dto";

const toSnakeCaseResponse = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(toSnakeCaseResponse);
  if (!value || typeof value !== "object" || value instanceof Date)
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      toSnakeCaseResponse(item),
    ]),
  );
};

@Public()
@Controller("api/v1/features")
export class FeatureController {
  constructor(
    @Inject(MerchantRepository) private readonly repository: MerchantRepository,
  ) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("feature_code") featureCode?: string,
    @Query("feature_type") featureType?: string,
  ) {
    const features = (await this.repository.listFeatures(status)).filter(
      (feature) =>
        (!featureCode ||
          feature.featureCode
            .toLowerCase()
            .includes(featureCode.trim().toLowerCase())) &&
        (!featureType ||
          feature.featureType.toLowerCase() ===
            featureType.trim().toLowerCase()),
    );
    return {
      success: true,
      count: features.length,
      features: toSnakeCaseResponse(features),
    };
  }

  @Get(":id_or_key")
  async get(@Param("id_or_key") idOrKey: string) {
    const feature = await this.repository.getFeatureByIdOrKey(idOrKey);
    if (!feature) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return { success: true, feature: toSnakeCaseResponse(feature) };
  }

  @Post()
  async create(@Body() body: CreateFeatureDto) {
    const feature = await this.repository.createFeature(body);
    return {
      success: true,
      message: "Feature created successfully",
      feature: toSnakeCaseResponse(feature),
    };
  }

  @Put(":id_or_key")
  async update(
    @Param("id_or_key") idOrKey: string,
    @Body() body: UpdateFeatureDto,
  ) {
    const updated = await this.repository.updateFeature(idOrKey, body);
    if (!updated) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return {
      success: true,
      message: "Feature updated successfully",
      feature: toSnakeCaseResponse(updated),
    };
  }

  @Delete(":id_or_key")
  async delete(@Param("id_or_key") idOrKey: string) {
    const deleted = await this.repository.deleteFeature(idOrKey);
    if (!deleted) throw new NotFoundException(`Feature '${idOrKey}' not found`);
    return { success: true, message: "Feature deactivated successfully" };
  }
}
