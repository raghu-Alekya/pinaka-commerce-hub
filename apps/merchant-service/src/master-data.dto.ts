import { Transform } from 'class-transformer';
import { IsNumber, Min, Max, IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class MasterFieldsDto {
  @ValidateIf((_, value) => value !== undefined) @IsString() description?: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
export class StoreTypeDto extends MasterFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(50) storeTypeCode!: string;
}
export class FeatureDto extends MasterFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) featureKey!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) category!: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(['BOOLEAN', 'LIMIT', 'CONFIG', 'TEXT']) featureType?: string;
}


export class RoleTemplateDto extends MasterFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(50) roleCode!: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(['MERCHANT', 'STORE']) scopeType?: string;
}
export class PlanDto extends MasterFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(50) planCode!: string;
  @IsIn(['FLAT', 'PER_STORE', 'PER_DEVICE', 'CUSTOM']) billingModel!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) basePrice!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['MONTHLY', 'ANNUAL']) billingCycle!: string;
}
