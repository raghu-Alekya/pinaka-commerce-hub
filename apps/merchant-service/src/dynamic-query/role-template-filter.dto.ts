import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RoleTemplateFilterDTO {
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
  scopeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}

/** Merchant copies and the master catalog share this shape. */
export interface RoleTemplateRecord {
  id: string;
  merchantId: string | null;
  sourceRoleTemplateId: string | null;
  roleCode: string;
  name: string;
  description: string;
  scopeType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
