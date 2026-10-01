import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { RoleScopeType, RoleTemplateStatus } from '../../../entities/role-template.entity';

export class CreateRoleTemplateDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleCode?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RoleScopeType)
  scopeType?: RoleScopeType;

  @IsOptional()
  @IsEnum(RoleTemplateStatus)
  status?: RoleTemplateStatus;
}

export class UpdateRoleTemplateDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RoleScopeType)
  scopeType?: RoleScopeType;

  @IsOptional()
  @IsEnum(RoleTemplateStatus)
  status?: RoleTemplateStatus;
}
