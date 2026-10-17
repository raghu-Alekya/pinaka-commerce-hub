import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class DashboardFiltersDto {
  @IsOptional()
  @IsUUID()
  merchant_id?: string;

  @IsOptional()
  @IsUUID()
  store_id?: string;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;
}
