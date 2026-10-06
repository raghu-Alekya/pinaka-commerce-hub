import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  RoleScopeType,
  RoleTemplateStatus,
} from '../../../entities/role-template.entity';

export class CreateRoleTemplateDto {
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

export class UpdateRoleTemplateDto {
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
