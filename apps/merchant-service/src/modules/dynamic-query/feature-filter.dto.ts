import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FeatureFilterDTO {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  /** Subscription id or subscription code. Limits features to that subscription's plan. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}
