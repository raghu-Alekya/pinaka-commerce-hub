import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PosSafeDropTubeDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PosSafeDropDenominationDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MaxLength(255)
  imageName!: string;

  @IsString()
  @MaxLength(2_800_000)
  imageData!: string;
}

export class SavePosSafeDropDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(100)
  primarySafe!: string;

  @IsBoolean()
  dropEnabled!: boolean;

  @ValidateIf((value: SavePosSafeDropDto) => value.enabled && value.dropEnabled)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  threshold?: number;

  @ValidateIf((value: SavePosSafeDropDto) => value.enabled && value.dropEnabled)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  minimum?: number;

  @ValidateIf((value: SavePosSafeDropDto) => value.enabled && value.dropEnabled)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maximum?: number;

  @IsBoolean()
  managerApproval!: boolean;

  @IsBoolean()
  cashierInitiated!: boolean;

  @IsBoolean()
  reasonRequired!: boolean;

  @IsOptional()
  @Transform(({ value }) => value === null || value === "" ? null : Number(value))
  @IsInt()
  @Min(1)
  tubeSize?: number | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosSafeDropTubeDto)
  tubes: PosSafeDropTubeDto[] = [];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosSafeDropDenominationDto)
  drops: PosSafeDropDenominationDto[] = [];
}
