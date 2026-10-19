import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { RecordStatus } from './entities/commerce-enums';

export class CreateStoreTypeFeatureDto extends AuditInputDto {
  @IsUUID()
  storeTypeId!: string;

  @IsUUID()
  featureId!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateStoreTypeFeatureDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  storeTypeId?: string;

  @IsOptional()
  @IsUUID()
  featureId?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
