import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Every field is optional. Omitted fields are not applied, so one method covers every parent scope. */
export class EmployeeFilterDTO {
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
  @MaxLength(100)
  roleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}
