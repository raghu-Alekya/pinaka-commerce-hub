import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { VendorStatus, VendorType } from './entities/vendor.entity';

const blankToUndefined = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function normalizeVendorType(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'SUPPLER' || normalized === 'SUPPLIER') return VendorType.SUPPLIER;
  if (normalized === 'ORGANIZER' || normalized === 'ORGANISER') return VendorType.ORGANIZER;
  return normalized;
}

export class CreateVendorDto {
  @Transform(blankToUndefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  vendorName!: string;

  @Transform(({ value }) => normalizeVendorType(value))
  @IsIn([VendorType.ORGANIZER, VendorType.SUPPLIER])
  vendorType!: VendorType;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vendorCode?: string;

  @Transform(blankToUndefined)
  @ValidateIf((body: CreateVendorDto) => body.vendorType === VendorType.ORGANIZER || body.contactPerson !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  contactPerson?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  productCategory?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsIn([VendorStatus.ACTIVE, VendorStatus.INACTIVE])
  status?: VendorStatus;
}

export class UpdateVendorDto {
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  vendorName?: string;

  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : normalizeVendorType(value)))
  @IsOptional()
  @IsIn([VendorType.ORGANIZER, VendorType.SUPPLIER])
  vendorType?: VendorType;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vendorCode?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  contactPerson?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  productCategory?: string;

  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsIn([VendorStatus.ACTIVE, VendorStatus.INACTIVE])
  status?: VendorStatus;
}
