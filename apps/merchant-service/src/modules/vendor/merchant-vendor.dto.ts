import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditInputDto } from '../../audit.dto';
import { RecordStatus } from '../../entities/commerce-enums';

export class AddMerchantVendorsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  vendorIds!: string[];
}

export class CreateMerchantVendorDto extends AuditInputDto {
  @IsUUID()
  merchantId!: string;

  @IsUUID()
  vendorId!: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateMerchantVendorDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
