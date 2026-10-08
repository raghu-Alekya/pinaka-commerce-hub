import { IsNotEmpty, IsString } from 'class-validator';

export class MerchantStoreLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Merchant identifier (email, code, or name) is required' })
  merchantIdentifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Store ID or Store Code is required' })
  storeId!: string;
}
