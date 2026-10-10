import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { RecordStatus } from '../../../entities/commerce-enums';

export class AddMerchantTendorsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  tendorIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tendorCodes?: string[];
}

export class CreateMerchantTendorDto extends AuditInputDto {
  @IsUUID()
  merchantId!: string;

  @IsUUID()
  tendorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tendorCode?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}

export class UpdateMerchantTendorDto extends AuditInputDto {
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsUUID()
  tendorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tendorCode?: string | null;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
