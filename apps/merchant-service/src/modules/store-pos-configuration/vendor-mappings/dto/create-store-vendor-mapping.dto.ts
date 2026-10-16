import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class CreateStoreVendorMappingDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID()
  store_id!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID()
  vendor_id!: string;
}
