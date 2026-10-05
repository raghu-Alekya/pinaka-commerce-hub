import { IsOptional, IsString, MaxLength } from 'class-validator';
import { StoreTypeStatus } from '../../../entities/store-type.entity';

export class CreateStoreTypeDto {
  @IsOptional()
  @IsString()
  storeTypeCode?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  status?: StoreTypeStatus | string;
}

export class UpdateStoreTypeDto {
  @IsOptional()
  @IsString()
  storeTypeCode?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  status?: StoreTypeStatus | string;
}
