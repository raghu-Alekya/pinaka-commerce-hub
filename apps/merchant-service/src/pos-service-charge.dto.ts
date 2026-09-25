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

export const SERVICE_CHARGE_APPLY_TO = ['order-total', 'line-item'] as const;
export const SERVICE_CHARGE_DEFAULT_TYPE = ['percentage', 'fixed'] as const;
export const SERVICE_CHARGE_FEE_TYPE = ['Percentage', 'Fixed'] as const;
export const SERVICE_CHARGE_APPLIES_TO = ['Dine-In', 'Delivery', 'Takeaway', 'All'] as const;

export class PosServiceChargeTierDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(50)
  from!: string;

  @IsString()
  @MaxLength(50)
  to!: string;

  @IsString()
  @MaxLength(50)
  fee!: string;

  @IsIn(SERVICE_CHARGE_FEE_TYPE)
  feeType!: string;

  @IsIn(SERVICE_CHARGE_APPLIES_TO)
  appliesTo!: string;
}

export class SavePosServiceChargeDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(SERVICE_CHARGE_APPLY_TO)
  applyTo!: string;

  @IsIn(SERVICE_CHARGE_DEFAULT_TYPE)
  defaultType!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxLimit!: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosServiceChargeTierDto)
  tiers: PosServiceChargeTierDto[] = [];
}
