import { IsIn, IsOptional, IsString } from 'class-validator';

export class AdministrationOverviewQueryDto {
  @IsOptional()
  @IsString()
  @IsIn([
    'today',
    'last_7_days',
    'last_30_days',
    'last_90_days',
    'last_365_days',
    'month',
    'quarter',
    'year',
  ])
  date_range?: string;

  @IsOptional()
  @IsString()
  merchant_id?: string;

  @IsOptional()
  @IsString()
  plan_id?: string;

  @IsOptional()
  @IsString()
  store_id?: string;
}
