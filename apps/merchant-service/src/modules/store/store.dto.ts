import { StoreSetupDto } from '../master/store-setup/store-setup.dto';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsEnum, IsObject, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { AuditInputDto } from '../../audit.dto';
import { OperationalStatus, StoreStatus, StoreChannelConfig, StoreWebsiteConnectorConfig } from '../../entities/store.entity';

function fromAliases(...keys: string[]) {
  return Transform(({ obj, value }) => {
    if (value !== undefined && value !== null && value !== '') return value;
    for (const key of keys) {
      const item = obj?.[key];
      if (item !== undefined && item !== null && item !== '') return item;
    }
    return value;
  });
}

class StoreInputDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @fromAliases('merchantId')
  merchant_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @fromAliases('storeTypeId', 'type', 'storeType')
  store_type_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  storeTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @fromAliases('storeCode', 'store_id', 'storeId')
  store_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  store_id?: string;

  @ValidateIf((object) => !String(object.store_name || object.storeName || '').trim())
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  store_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  storeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @fromAliases('storeWebsiteUrl', 'url')
  store_website_url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @fromAliases('addressLine1', 'address')
  address_line1?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @fromAliases('addressLine2')
  address_line2?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @fromAliases('postalCode', 'zip')
  postal_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  zip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null && value !== '')
  @IsEmail()
  @MaxLength(255)
  @fromAliases('storeEmail', 'email')
  store_email?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @fromAliases('activationPin')
  activation_pin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  activationPin?: string;

  @IsOptional()
  @IsEnum(OperationalStatus)
  @fromAliases('operationalStatus')
  operational_status?: OperationalStatus;

  @IsOptional()
  @IsArray()
  channels?: StoreChannelConfig[];

  @IsOptional()
  websiteConnector?: StoreWebsiteConnectorConfig | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoreSetupDto)
  onboardingSetup?: StoreSetupDto;

  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2800000)
  logo?: string;

  @IsOptional()
  @IsArray()
  hours?: StoreSetupDto['hours'];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  devices?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  roles?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  rolePermissions?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  employees?: StoreSetupDto['employees'];
}

export class CreateStoreDto extends StoreInputDto {}

export class UpdateStoreDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @fromAliases('merchantId')
  merchant_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @fromAliases('storeTypeId', 'type', 'storeType')
  store_type_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @fromAliases('storeCode', 'store_id', 'storeId')
  store_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  store_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  storeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @fromAliases('storeWebsiteUrl', 'url')
  store_website_url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @fromAliases('addressLine1', 'address')
  address_line1?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @fromAliases('addressLine2')
  address_line2?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @fromAliases('postalCode', 'zip')
  postal_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  zip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null && value !== '')
  @IsEmail()
  @MaxLength(255)
  @fromAliases('storeEmail', 'email')
  store_email?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @fromAliases('activationPin')
  activation_pin?: string;

  @IsOptional()
  @IsEnum(OperationalStatus)
  @fromAliases('operationalStatus')
  operational_status?: OperationalStatus;

  @IsOptional()
  @IsArray()
  channels?: StoreChannelConfig[];

  @IsOptional()
  websiteConnector?: StoreWebsiteConnectorConfig | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoreSetupDto)
  onboardingSetup?: StoreSetupDto;

  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @IsOptional()
  @IsArray()
  hours?: StoreSetupDto['hours'];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  rolePermissions?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  employees?: StoreSetupDto['employees'];
}

export class CreateStoresDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreDto)
  stores!: CreateStoreDto[];
}
