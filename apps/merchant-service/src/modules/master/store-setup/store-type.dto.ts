import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { StoreTypeStatus } from '../../../entities/store-type.entity';

export class CreateStoreTypeDto {
  // Kept for compatibility with existing shared repository code. The Store
  // Type API ignores this value because PostgreSQL generates the code.
  @IsOptional()
  @IsString()
  storeTypeCode!: string;

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

export class UpdateStoreTypeDto {
  // Kept for compatibility with existing shared repository code. The Store
  // Type API never updates the trigger-owned code.
  @IsOptional()
  @IsString()
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
