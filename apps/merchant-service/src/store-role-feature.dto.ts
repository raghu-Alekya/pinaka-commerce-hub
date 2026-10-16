import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { RecordStatus } from './entities/commerce-enums';

export class CreateStoreRoleFeatureDto extends AuditInputDto {
  @IsUUID()
  storeId!: string;

  @IsUUID()
  roleId!: string;

  @IsOptional()
  @IsArray()
  features?: unknown[];

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateStoreRoleFeatureDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsArray()
  features?: unknown[];

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
