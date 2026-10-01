import { StoreSetupDto } from '../master/store-setup/store-setup.dto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { AuditInputDto } from '../../audit.dto';
import { OperationalStatus, StoreStatus, StoreChannelConfig, StoreWebsiteConnectorConfig } from '../../entities/store.entity';

export class CreateStoreDto extends AuditInputDto {
  @IsUUID()
  merchantId!: string;

  @IsUUID()
  storeTypeId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeCode?: string;

  @IsString()
  @MaxLength(255)
  storeName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  storeWebsiteUrl?: string | null;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

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
  storeEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsString()
  @MaxLength(10)
  activationPin!: string;

  @IsOptional()
  @IsEnum(OperationalStatus)
  operationalStatus?: OperationalStatus;

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
}

export class UpdateStoreDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsUUID()
  storeTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  storeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  storeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  storeWebsiteUrl?: string | null;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

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
  storeEmail?: string;

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
  activationPin?: string;

  @IsOptional()
  @IsEnum(OperationalStatus)
  operationalStatus?: OperationalStatus;

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
}

export class CreateStoresDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreDto)
  stores!: CreateStoreDto[];
}
