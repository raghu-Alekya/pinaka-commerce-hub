import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { FeatureStatus } from './entities/feature.entity';

export class CreateFeatureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  featureKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category!: string;

  @IsString()
  @IsOptional()
  featureType?: string;

  @IsEnum(FeatureStatus)
  @IsOptional()
  status?: FeatureStatus;
}

export class UpdateFeatureDto {
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @IsString()
  @IsOptional()
  featureType?: string;

  @IsEnum(FeatureStatus)
  @IsOptional()
  status?: FeatureStatus;
}
