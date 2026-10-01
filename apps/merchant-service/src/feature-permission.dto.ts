import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { PermissionType, RecordStatus } from './entities/commerce-enums';

export class CreateFeaturePermissionDto extends AuditInputDto {
  @IsUUID()
  featureId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  permissionCode?: string;

  @IsEnum(PermissionType)
  permissionType!: PermissionType;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateFeaturePermissionDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  featureId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  permissionCode?: string;

  @IsOptional()
  @IsEnum(PermissionType)
  permissionType?: PermissionType;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
