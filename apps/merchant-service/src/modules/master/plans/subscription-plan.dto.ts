import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, IsInt, Min, Max, IsArray, ArrayUnique, IsIn, IsNumber, ValidateIf } from 'class-validator';

export class SubscriptionPlanFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(100) planName!: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(2000) description?: string;
  @IsInt() @Min(1) @Max(2147483647) maxStoresAllowed!: number;
  @IsArray() @ArrayUnique() @IsString({ each: true }) @Matches(/\S/, { each: true }) @MaxLength(100, { each: true }) entitlements!: string[];
  @IsIn(['MONTHLY', 'ANNUAL', 'FREE_TRIAL']) billingCycle!: 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL';
  @IsInt() @Min(0) @Max(2147483647) trialDays!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['ACTIVE', 'INACTIVE']) status!: 'ACTIVE' | 'INACTIVE';
}

export class CreateSubscriptionPlanDto extends SubscriptionPlanFieldsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Matches(/^[A-Z][A-Z0-9_]{0,49}$/) planCode!: string;
}
