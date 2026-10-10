import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class CreateStoreDeviceMappingDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID()
  store_id!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID()
  device_id!: string;
}
