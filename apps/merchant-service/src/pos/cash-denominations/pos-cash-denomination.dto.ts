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
  ValidateIf,
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

  @ValidateIf((item: PosCashDenominationItemDto) => !item.image)
  @IsString()
  @MaxLength(1_500_000)
  imageData?: string;

  @ValidateIf((item: PosCashDenominationItemDto) => !item.imageData)
  @IsString()
  @MaxLength(2048)
  image?: string;
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
