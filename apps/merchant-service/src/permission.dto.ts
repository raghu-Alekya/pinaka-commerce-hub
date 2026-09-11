import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, MaxLength } from 'class-validator';
import { PermissionStatus } from './entities/permission.entity';

export class CreatePermissionDto {
  @IsUUID()
  @IsNotEmpty()
  featureId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  permissionKey!: string;

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

export class UpdatePermissionDto {
  @IsUUID()
  @IsOptional()
  featureId?: string;

  @IsString()
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
