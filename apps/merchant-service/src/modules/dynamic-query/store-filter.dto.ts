import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StoreFilterDTO {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  /** Matches city, state, country, or street inside the store address. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}
