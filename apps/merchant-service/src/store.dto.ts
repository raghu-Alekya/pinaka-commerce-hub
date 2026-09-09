import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, ArrayMaxSize, IsArray, ValidateNested, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { StoreStatus } from './entities/store.entity';

export class UpdateStoreDto {
  @IsString() @IsNotEmpty() @MaxLength(100) merchantId!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) storeId!: string;
  @IsString() @Matches(/\S/) @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(50) type?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? (value.split(' - ')[0].trim().toUpperCase() || undefined) : value)
  @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @IsEnum(StoreStatus) status?: StoreStatus;
  @IsString() @Matches(/\S/) @MaxLength(1000) address!: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsString() @Matches(/\S/) @MaxLength(255) city!: string;
  @IsString() @Matches(/\S/) @MaxLength(255) state!: string;
  @IsString() @Matches(/\S/) @MaxLength(50) zip!: string;
}

export class CreateStoreDto extends UpdateStoreDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Matches(/\S/) @MaxLength(50) declare storeId: string;
}

export class CreateStoresDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => CreateStoreDto)
  stores!: CreateStoreDto[];
}
