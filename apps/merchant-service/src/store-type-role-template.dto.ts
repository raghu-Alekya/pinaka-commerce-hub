import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { RecordStatus } from './entities/commerce-enums';

export class CreateStoreTypeRoleTemplateDto extends AuditInputDto {
  @IsUUID()
  storeTypeId!: string;

  @IsUUID()
  roleTemplateId!: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateStoreTypeRoleTemplateDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  storeTypeId?: string;

  @IsOptional()
  @IsUUID()
  roleTemplateId?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
