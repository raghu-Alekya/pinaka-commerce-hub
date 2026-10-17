import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VendorFilterDTO {
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
  @MaxLength(20)
  vendorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  productCategory?: string;
}
