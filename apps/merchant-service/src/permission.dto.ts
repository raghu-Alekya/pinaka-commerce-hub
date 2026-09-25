import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { PermissionStatus } from './entities/permission.entity';

export class CreatePermissionDto {
  @IsString()
  @IsNotEmpty()
  featureId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  permissionKey!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  key?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PermissionStatus)
  @IsOptional()
  status?: PermissionStatus;
}

export class CreateFeaturePermissionDto {
  @IsString()
  @IsOptional()
  featureId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  permissionKey!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  key?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PermissionStatus)
  @IsOptional()
  status?: PermissionStatus;
}

export class UpdateFeaturePermissionDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  permissionKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  key?: string;

  @IsString()
  @IsOptional()
  featureId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PermissionStatus)
  @IsOptional()
  status?: PermissionStatus;
}

export class UpdatePermissionDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  permissionKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  key?: string;

  @IsString()
  @IsOptional()
  featureId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PermissionStatus)
  @IsOptional()
  status?: PermissionStatus;
}
