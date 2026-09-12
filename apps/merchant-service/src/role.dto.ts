import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsUUID, MaxLength } from 'class-validator';
import { RoleStatus } from './entities/role.entity';
import { RoleScopeType } from './entities/role-template.entity';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  merchantId!: string;

  @IsUUID()
  @IsOptional()
  sourceRoleTemplateId?: string;

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

  @IsBoolean()
  @IsOptional()
  isCustom?: boolean;

  @IsEnum(RoleStatus)
  @IsOptional()
  status?: RoleStatus;
}

export class UpdateRoleDto {
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

  @IsBoolean()
  @IsOptional()
  isCustom?: boolean;

  @IsEnum(RoleStatus)
  @IsOptional()
  status?: RoleStatus;
}
