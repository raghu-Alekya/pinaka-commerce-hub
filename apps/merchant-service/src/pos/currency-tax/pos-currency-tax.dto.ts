import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const POS_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD'] as const;
export const POS_ROUNDING = ['nearest-cent', 'nearest-dollar', 'down', 'up'] as const;
export const POS_TAX_CALCULATION = ['item-price', 'subtotal', 'total'] as const;

export class PosTaxClassDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rate!: number;
}

export class SavePosCurrencyTaxDto {
  @IsIn(POS_CURRENCIES)
  currency!: string;

  @IsIn(POS_ROUNDING)
  rounding!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  decimalPlaces!: number;

  @IsBoolean()
  taxEnabled!: boolean;

  @ValidateIf((value: SavePosCurrencyTaxDto) => value.taxEnabled)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  defaultTaxRate?: number;

  @IsIn(POS_TAX_CALCULATION)
  taxCalculation!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosTaxClassDto)
  taxClasses: PosTaxClassDto[] = [];
}
