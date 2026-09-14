import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { RoleTemplateStatus, RoleScopeType } from './entities/role-template.entity';

export class CreateRoleTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  roleCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

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

export class UpdateRoleTemplateDto {
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
