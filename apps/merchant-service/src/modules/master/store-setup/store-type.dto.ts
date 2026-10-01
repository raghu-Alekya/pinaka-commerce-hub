import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { StoreTypeStatus } from '../../../entities/store-type.entity';

export class CreateStoreTypeDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeTypeCode?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(StoreTypeStatus)
  status?: StoreTypeStatus;
}

export class UpdateStoreTypeDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeTypeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(StoreTypeStatus)
  status?: StoreTypeStatus;
}
