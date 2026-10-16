import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AuditInputDto {
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;

  @IsOptional()
  @IsUUID()
  createdBy?: string | null;

  @IsOptional()
  @IsUUID()
  updatedBy?: string | null;
}
