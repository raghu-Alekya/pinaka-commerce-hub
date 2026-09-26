import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PosCashbackTierDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  from!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  to!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  fee!: number;
}

export class SavePosCashbackDto {
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((value: SavePosCashbackDto) => value.enabled || value.maxCashback !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxCashback?: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosCashbackTierDto)
  tiers: PosCashbackTierDto[] = [];
}
