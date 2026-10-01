import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested, IsDefined } from 'class-validator';
import { CreateMerchantDto } from '../../merchant.dto';
import { CreateStoreDto } from '../store/store.dto';
import { BillingCycle, SubscriptionStatus } from '../../entities/subscription.entity';

export class OnboardingMerchantDto extends CreateMerchantDto {}

export class OnboardingSubscriptionDto {
  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subscriptionCode?: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price!: number;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  renewalDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trialEndDate?: string;

  @IsOptional()
  @IsArray()
  entitlements?: unknown[];
}

export class MerchantOnboardingDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => OnboardingMerchantDto)
  merchant!: OnboardingMerchantDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingSubscriptionDto)
  subscription?: OnboardingSubscriptionDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreDto)
  stores?: CreateStoreDto[];
}
