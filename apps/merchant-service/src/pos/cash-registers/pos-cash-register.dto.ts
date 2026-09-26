import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosCashRegisterDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(100)
  pos!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxCash!: number;

  @IsBoolean()
  safeDrop!: boolean;

  @IsIn(['Active', 'Inactive'])
  status!: string;
}

export class SavePosCashRegisterDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosCashRegisterDto)
  registers: PosCashRegisterDto[] = [];
}
