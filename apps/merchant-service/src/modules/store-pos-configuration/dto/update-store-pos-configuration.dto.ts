import {
  IsObject,
  IsOptional,
  IsString,
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
}