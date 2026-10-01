import { IsArray, IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { AuditInputDto } from '../../../audit.dto';
import { PlanBillingCycle, PlanBillingModel, PlanStatus } from '../../../entities/plan.entity';

export class CreatePlanDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  planCode?: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PlanBillingModel)
  billingModel?: PlanBillingModel;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(PlanBillingCycle)
  billingCycle?: PlanBillingCycle;

  @IsOptional()
  @IsUUID()
  storeTypeId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  storesLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  terminalLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  additionalTerminalPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  employeesLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  additionalEmployeePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  trialPeriod?: number;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  planEndDate?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includedFeatures?: string[];

  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;
}

export class UpdatePlanDto extends AuditInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  planCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PlanBillingModel)
  billingModel?: PlanBillingModel;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(PlanBillingCycle)
  billingCycle?: PlanBillingCycle;

  @IsOptional()
  @IsUUID()
  storeTypeId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  storesLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  terminalLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  additionalTerminalPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  employeesLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  additionalEmployeePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  trialPeriod?: number;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  planEndDate?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includedFeatures?: string[];

  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;
}
