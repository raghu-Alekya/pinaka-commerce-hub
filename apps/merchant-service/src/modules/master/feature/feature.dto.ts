import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { FeatureStatus } from '../../../entities/feature.entity';

export class CreateFeatureDto extends AuditInputDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  feature_code!: string;

  @IsString() @MaxLength(150)
  name!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  feature_type!: string;

  @IsOptional() @IsEnum(FeatureStatus)
  status?: FeatureStatus;
}

export class UpdateFeatureDto extends AuditInputDto {
  @IsOptional() @IsString() @MaxLength(100)
  feature_code?: string;

  @IsOptional() @IsString() @MaxLength(150)
  name?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  feature_type?: string;

  @IsOptional() @IsEnum(FeatureStatus)
  status?: FeatureStatus;
}
