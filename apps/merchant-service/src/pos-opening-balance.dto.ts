import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, Min } from 'class-validator';

export class SavePosOpeningBalanceDto {
  @IsBoolean()
  requireOpeningBalance!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  defaultOpeningAmount!: number;

  @IsBoolean()
  managerApprovalRequired!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  varianceTolerance!: number;

  @IsBoolean()
  allowCashierOverride!: boolean;

  @IsBoolean()
  countByDenomination!: boolean;
}
