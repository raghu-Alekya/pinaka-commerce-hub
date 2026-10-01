import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditInputDto } from './audit.dto';
import { MerchantStatus } from './entities/merchant.entity';

export class CreateMerchantDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantCode?: string;

  @IsString()
  @MaxLength(100)
  merchantId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(50)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  onboardingStep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessDisplayName?: string;

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
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;
}

export class UpdateMerchantDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  onboardingStep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessDisplayName?: string;

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
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;
}
