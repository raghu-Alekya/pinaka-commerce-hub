import { IsOptional, IsString } from 'class-validator';

export class MerchantStoreLoginDto {
  @IsOptional()
  @IsString()
  merchantIdentifier?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  merchantCode?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  storeCode?: string;

  @IsOptional()
  @IsString()
  storeName?: string;
}
