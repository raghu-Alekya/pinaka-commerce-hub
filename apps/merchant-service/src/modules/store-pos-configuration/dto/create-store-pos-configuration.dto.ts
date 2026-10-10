import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateStorePosConfigurationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  configurationName!: string;

  @IsObject()
  configurationValue!: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  createdBy?: string;
}