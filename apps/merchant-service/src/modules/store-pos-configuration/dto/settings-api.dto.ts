import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const binaryValues = [0, 1, '0', '1', false, true] as const;

export class GeneralSettingsDto {
  @IsOptional() business_name?: unknown;
  @IsOptional() email?: unknown;
  @IsOptional() language?: unknown;
  @IsOptional() nav_bar_location?: unknown;
  @IsOptional() pos_theme?: unknown;
  @IsOptional() contact_info?: unknown;
  @IsOptional() address?: unknown;
  @IsOptional() currency?: unknown;
  @IsOptional() timezone?: unknown;
  @IsOptional() email_notification?: unknown;
  @IsOptional() sound_notification?: unknown;
  @IsOptional() version?: unknown;
  @IsOptional() image_url?: unknown;
  @IsOptional() logo_url?: unknown;
  // Business and receipt fields are stored with the existing general settings
  // JSON document; personal employee details remain in the employee API.
  @IsOptional() company_name?: unknown;
  @IsOptional() gstin?: unknown;
  @IsOptional() receipt_header?: unknown;
  @IsOptional() receipt_footer?: unknown;
  @IsOptional() @IsString() @MaxLength(255) device_id?: string;
}

export class DeviceSettingsDto {
  @IsOptional() @IsString() @MaxLength(255) device_id?: string;
  @IsOptional() @IsString() @MaxLength(255) kot_printer?: string;
  @IsOptional() @IsString() @MaxLength(255) receipt_printer?: string;
  @IsOptional() @IsString() @MaxLength(50) paper_size?: string;
  @IsOptional() @IsString() @MaxLength(50) connection_type?: string;
  @IsOptional() @IsString() @MaxLength(255) kitchen_printer?: string;
  @IsOptional() @IsString() @MaxLength(255) bar_printer?: string;
}

export class CashSettingsDto {
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsIn(binaryValues) enable_safes?: 0 | 1 | '0' | '1' | boolean;
  @IsOptional() @IsIn(binaryValues) enable_safes_drop?: 0 | 1 | '0' | '1' | boolean;
}

export class ShopAddressDto {
  @IsOptional() @IsString() @MaxLength(255) pinaka_pos_name?: string;
  @IsOptional() @IsEmail() @MaxLength(255) pinaka_pos_email?: string;
  @IsOptional() @IsString() @MaxLength(100) pinaka_pos_phone?: string;
  @IsOptional() @IsString() @MaxLength(1000) pinaka_pos_business_address?: string;
  @IsOptional() @IsString() @MaxLength(100) pinaka_pos_business_city?: string;
  @IsOptional() @IsString() @MaxLength(100) pinaka_pos_business_state?: string;
  @IsOptional() @IsString() @MaxLength(30) pinaka_pos_business_postcode?: string;
}

export class BusinessInfoDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ShopAddressDto)
  shop_address!: ShopAddressDto;
}

export class EnableTaxesDto { @IsIn(binaryValues) enable_taxes!: 0 | 1 | '0' | '1' | boolean; }
export class EnableCouponsDto { @IsIn(binaryValues) enable_coupons!: 0 | 1 | '0' | '1' | boolean; }
export class SequentialCouponsDto { @IsIn(binaryValues) coupon_sequential!: 0 | 1 | '0' | '1' | boolean; }
export class EnableSafesDto { @IsIn(binaryValues) enable_safes!: 0 | 1 | '0' | '1' | boolean; }
export class EnableSafesDropDto { @IsIn(binaryValues) enable_safes_drop!: 0 | 1 | '0' | '1' | boolean; }
export class EnableCashbackDto { @IsIn(binaryValues) enable_cashback!: 0 | 1 | '0' | '1' | boolean; }
export class EnableServiceChargeDto { @IsIn(binaryValues) enable_service_charge!: 0 | 1 | '0' | '1' | boolean; }

export class EnableLoyaltyPointsDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['yes', 'no'])
  enable_loyalty_points!: 'yes' | 'no';
}
