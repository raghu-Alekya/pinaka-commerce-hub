import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosCashDenominationItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  amount!: number;

  @IsString()
  @MaxLength(255)
  imageName!: string;

  @IsString()
  @MaxLength(1_500_000)
  imageData!: string;
}

export class SavePosCashDenominationDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosCashDenominationItemDto)
  cashDenominations: PosCashDenominationItemDto[] = [];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosCashDenominationItemDto)
  coinDenominations: PosCashDenominationItemDto[] = [];
}
