import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDeviceDto {
  @IsString() @Matches(/\S/) @MaxLength(255) deviceName!: string;
  @IsIn(['POS Terminal', 'Kitchen Display', 'Barcode Scanner', 'Receipt Printer', 'Customer Display']) deviceType!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) serialNumber!: string;
  @IsString() @Matches(/\S/) @MaxLength(100) merchantId!: string;
  @IsString() @Matches(/\S/) @MaxLength(100) storeId!: string;
  @IsOptional() @Matches(/^$|^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$|^(?:[0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/) macAddress?: string;
  @IsOptional() @IsString() @MaxLength(255) model?: string;
  @IsOptional() @IsString() @MaxLength(255) manufacturer?: string;
  @IsOptional() @IsIn(['Active', 'Inactive']) status?: string;
  @IsOptional() @IsString() @MaxLength(100) timeZone?: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsString() @MaxLength(255) floor?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() enableImmediately?: boolean;
  @IsOptional() @IsString() @MaxLength(2796226)
  @Matches(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/) image?: string;
}
