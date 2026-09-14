import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { StoreTypeStatus } from './entities/store-type.entity';

export class CreateStoreTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  storeTypeCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(StoreTypeStatus)
  @IsOptional()
  status?: StoreTypeStatus;
}

export class UpdateStoreTypeDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(StoreTypeStatus)
  @IsOptional()
  status?: StoreTypeStatus;
}
