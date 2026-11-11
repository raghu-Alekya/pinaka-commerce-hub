import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateStorePosConfigurationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  configurationName?: string;

  @IsOptional()
  @IsObject()
  configurationValue?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  updatedBy?: string;

  // Printer settings clients may send the configuration fields at the root
  // of the PATCH body instead of wrapping them in configurationValue.
  @IsOptional() @IsString() @MaxLength(500) header?: string;
  @IsOptional() @IsString() @MaxLength(2000) footer?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @IsOptional() @IsString() @MaxLength(2000) logo?: string;
  @IsOptional() @IsString() @MaxLength(255) logoName?: string;
}
