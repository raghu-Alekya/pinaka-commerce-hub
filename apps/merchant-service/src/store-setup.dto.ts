import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class StoreHoursDto {
  @IsIn(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']) day!: string;
  @IsIn(['', 'Open', 'Closed', '24 hours']) status!: string;
  @IsOptional() @Matches(/^$|^([01]\d|2[0-3]):[0-5]\d$/) open?: string;
  @IsOptional() @Matches(/^$|^([01]\d|2[0-3]):[0-5]\d$/) close?: string;
  @IsOptional() @Transform(({ value }) => value === '' ? undefined : Number(value)) @IsInt() @Min(1) @Max(100) shifts?: number;
}

// Setup selections are stored separately from effective permissions/entitlements.
export class StoreSetupDto {
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(2800000) logo?: string;
  @IsOptional() @IsBoolean() licensed?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => StoreHoursDto) hours?: StoreHoursDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) devices?: Record<string, unknown>[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(100, { each: true }) features?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) roles?: Record<string, unknown>[];
}
