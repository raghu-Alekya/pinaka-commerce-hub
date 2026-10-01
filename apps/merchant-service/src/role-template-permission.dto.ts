import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { RecordStatus } from './entities/commerce-enums';

export class CreateRoleTemplatePermissionDto extends AuditInputDto {
  @IsUUID()
  roleTemplateId!: string;

  @IsUUID()
  permissionId!: string;

  @IsOptional()
  @IsBoolean()
  defaultAllowed?: boolean;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateRoleTemplatePermissionDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  roleTemplateId?: string;

  @IsOptional()
  @IsUUID()
  permissionId?: string;

  @IsOptional()
  @IsBoolean()
  defaultAllowed?: boolean;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
