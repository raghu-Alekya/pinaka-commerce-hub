import { ArrayUnique, IsArray, IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PlanCode, SubscriptionStatus } from './entities/subscription.entity';
const supplied = (_: unknown, value: unknown) => value !== undefined;
const nonNull = (_: unknown, value: unknown) => value !== undefined && value !== null;
export class SubscriptionFieldsDto {
  @ValidateIf(supplied) @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) planId?: string;
  @ValidateIf(supplied) @IsString() @Matches(/\S/) @MaxLength(100) subscriptionCode?: string;
  @ValidateIf(supplied) @IsIn(['MONTHLY','ANNUAL','FREE_TRIAL']) billingCycle?: 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL';
  @ValidateIf(supplied) @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @ValidateIf(supplied) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
  @ValidateIf(supplied) @Matches(/^[A-Z]{3}$/) currency?: string;
  @ValidateIf(nonNull) @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string | null;
  @ValidateIf(nonNull) @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) renewalDate?: string | null;
  @ValidateIf(nonNull) @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) trialEndDate?: string | null;
  @ValidateIf(nonNull) @IsInt() @Min(0) @Max(2147483647) licensedStoreCount?: number | null;
  @ValidateIf(nonNull) @IsInt() @Min(0) @Max(2147483647) licensedDeviceCount?: number | null;
  // Compatibility aliases for the existing onboarding clients.
  @ValidateIf(supplied) @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,49}$/) planCode?: PlanCode;
  @ValidateIf(supplied) @IsString() @Matches(/\S/) @MaxLength(100) planName?: string;
  @ValidateIf(supplied) @IsInt() @Min(0) @Max(2147483647) maxStoresAllowed?: number;
  @ValidateIf(supplied) @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(100,{each:true}) entitlements?: string[];
  @ValidateIf(supplied) @IsInt() @Min(0) @Max(2147483647) trialDays?: number;
  @ValidateIf(supplied) @IsISO8601({strict:true}) currentPeriodStart?: string;
  @ValidateIf(supplied) @IsISO8601({strict:true}) currentPeriodEnd?: string;
}
export class CreateSubscriptionDto extends SubscriptionFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(100) merchantId!: string;
  @ValidateIf(supplied) @IsString() @Matches(/\S/) @MaxLength(100) id?: string;
}
