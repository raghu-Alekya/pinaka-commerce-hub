import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsDefined } from 'class-validator';
import { CreateStoreDto } from './store.dto';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class OnboardingMerchantDto {
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(100) code!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(255) business!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(255) display!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @Transform(trim) @IsEmail() @MaxLength(255) email!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(50) phone!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(100) country!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(100) city!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(100) state!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(1000) address!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(30) postal!: string;
}

export class OnboardingSubscriptionDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,49}$/) planCode!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @IsIn(['MONTHLY', 'ANNUAL']) billingCycle!: 'MONTHLY' | 'ANNUAL';
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) licensedStoreCount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) licensedDeviceCount?: number;
}

export class MerchantOnboardingDto {
  @IsDefined() @ValidateNested() @Type(() => OnboardingMerchantDto) merchant!: OnboardingMerchantDto;
  @IsOptional() @ValidateNested() @Type(() => OnboardingSubscriptionDto) subscription?: OnboardingSubscriptionDto;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CreateStoreDto) stores?: CreateStoreDto[];
}

