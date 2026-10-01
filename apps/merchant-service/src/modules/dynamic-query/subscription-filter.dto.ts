import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubscriptionFilterDTO {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

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
  @MaxLength(20)
  status?: string;
}
