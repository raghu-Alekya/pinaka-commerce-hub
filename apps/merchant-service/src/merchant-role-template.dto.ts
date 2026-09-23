import { IsString, IsOptional, IsEnum, IsUUID, MaxLength, IsNotEmpty } from 'class-validator';
import { RoleScopeType, RoleTemplateStatus } from './entities/role-template.entity';

export class CreateMerchantRoleTemplateDto {
  @IsUUID()
  @IsOptional()
  sourceRoleTemplateId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  roleCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(RoleScopeType)
  @IsOptional()
  scopeType?: RoleScopeType;

  @IsEnum(RoleTemplateStatus)
  @IsOptional()
  status?: RoleTemplateStatus;
}

export class UpdateMerchantRoleTemplateDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(RoleScopeType)
  @IsOptional()
  scopeType?: RoleScopeType;

  @IsEnum(RoleTemplateStatus)
  @IsOptional()
  status?: RoleTemplateStatus;
}
