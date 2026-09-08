import { IsArray, ArrayUnique, IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PlanCode, SubscriptionStatus } from './entities/subscription.entity';

export class SubscriptionFieldsDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,49}$/) planCode!: PlanCode;
  @IsString() @Matches(/\S/) @MaxLength(100) planName!: string;
  @IsInt() @Min(1) @Max(2147483647) maxStoresAllowed!: number;
  @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(100, { each: true }) entitlements!: string[];
  @IsIn(['MONTHLY', 'ANNUAL', 'FREE_TRIAL']) billingCycle!: 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL';
  @IsInt() @Min(0) @Max(2147483647) trialDays!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price!: number;
  @IsEnum(SubscriptionStatus) status!: SubscriptionStatus;
  @ValidateIf((_, value) => value !== undefined) @IsISO8601() currentPeriodStart?: string;
  @ValidateIf((_, value) => value !== undefined) @IsISO8601() currentPeriodEnd?: string;
}

export class CreateSubscriptionDto extends SubscriptionFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(100) merchantId!: string;
  @ValidateIf((_, value) => value !== undefined) @IsString() @Matches(/\S/) @MaxLength(100) id?: string;
}
