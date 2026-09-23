import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export class CreateStoreRolePermissionDto {
  @IsUUID()
  permissionId!: string;

  @IsBoolean()
  @IsOptional()
  allowed?: boolean;
}

export class UpdateStoreRolePermissionDto {
  @IsBoolean()
  allowed!: boolean;
}

export class BulkStoreRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreRolePermissionDto)
  items!: CreateStoreRolePermissionDto[];
}
