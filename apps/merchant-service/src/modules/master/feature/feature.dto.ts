import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { FeatureStatus, FeatureType } from '../../../entities/feature.entity';

export class CreateFeatureDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  featureCode?: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(FeatureType)
  featureType?: FeatureType;

  @IsOptional()
  @IsEnum(FeatureStatus)
  status?: FeatureStatus;
}

export class UpdateFeatureDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  featureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(FeatureType)
  featureType?: FeatureType;

  @IsOptional()
  @IsEnum(FeatureStatus)
  status?: FeatureStatus;
}
