import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsISO8601, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { BillingCycle, SubscriptionStatus } from '../../../entities/subscription.entity';

const supplied = (_: unknown, value: unknown) => value !== undefined;
const nonNull = (_: unknown, value: unknown) => value !== undefined && value !== null;

export class SubscriptionFieldsDto extends AuditInputDto {
  @ValidateIf(nonNull)
  @IsUUID()
  planId?: string | null;

  @ValidateIf(supplied)
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  subscriptionCode?: string;

  @ValidateIf(supplied)
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ValidateIf(supplied)
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ValidateIf(supplied)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price?: number;

  @ValidateIf(supplied)
  @IsBoolean()
  autoRenew?: boolean;

  @ValidateIf(nonNull)
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string | null;

  @ValidateIf(nonNull)
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  renewalDate?: string | null;

  @ValidateIf(nonNull)
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trialEndDate?: string | null;

  @ValidateIf(nonNull)
  @IsISO8601()
  cancelledAt?: string | null;

  @ValidateIf(supplied)
  @IsArray()
  @ArrayUnique()
  entitlements?: unknown[];
}

export class CreateSubscriptionDto extends SubscriptionFieldsDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  id!: string;

  @IsUUID()
  merchantId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  declare price: number;
}
