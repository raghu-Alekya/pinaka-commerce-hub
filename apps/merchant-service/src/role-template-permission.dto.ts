import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { PermissionStatus } from './entities/permission.entity';
import { PermissionType } from './entities/commerce-enums';

// The generic /permissions resource is backed by public.permissions.
export class CreatePermissionDto {
  @IsString() @IsNotEmpty() featureId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) permissionKey!: string;
  @IsString() @IsOptional() @MaxLength(100) key?: string;
  @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PermissionStatus) @IsOptional() status?: PermissionStatus;
}

export class UpdatePermissionDto {
  @IsString() @IsOptional() @MaxLength(100) permissionKey?: string;
  @IsString() @IsOptional() @MaxLength(100) key?: string;
  @IsString() @IsOptional() featureId?: string;
  @IsString() @IsNotEmpty() @IsOptional() @MaxLength(150) name?: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PermissionStatus) @IsOptional() status?: PermissionStatus;
}

// Feature scoped APIs are backed by public.feature_permissions.
export class CreateFeaturePermissionDto {
  @IsString() @IsOptional() feature_id?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) permission_code!: string;
  @IsEnum(PermissionType) permission_type!: PermissionType;
  @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PermissionStatus) @IsOptional() status?: PermissionStatus;
}

export class UpdateFeaturePermissionDto {
  @IsString() @IsOptional() @MaxLength(100) permission_code?: string;
  @IsEnum(PermissionType) @IsOptional() permission_type?: PermissionType;
  @IsString() @IsOptional() feature_id?: string;
  @IsString() @IsNotEmpty() @IsOptional() @MaxLength(150) name?: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(PermissionStatus) @IsOptional() status?: PermissionStatus;
}
