import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { StoreTypeStatus } from '../../../entities/store-type.entity';

export class CreateStoreTypeDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:ST-\d{3}|STT_\d{5})$/, { message: 'storeTypeCode must use ST-001 or STT_00001 format' })
  storeTypeCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:ST-\d{3}|STT_\d{5})$/, { message: 'code must use ST-001 or STT_00001 format' })
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
  @Matches(/^(?:ST-\d{3}|STT_\d{5})$/, { message: 'storeTypeCode must use ST-001 or STT_00001 format' })
  storeTypeCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:ST-\d{3}|STT_\d{5})$/, { message: 'code must use ST-001 or STT_00001 format' })
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
