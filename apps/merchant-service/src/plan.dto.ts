import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsInt, IsArray, IsISO8601, Min, MaxLength } from 'class-validator';
import { PlanStatus, PlanBillingModel, PlanBillingCycle } from './entities/plan.entity';
 
export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  planCode!: string;
 
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
 
  @IsString()
  @IsOptional()
  description?: string;
 
  @IsEnum(PlanBillingModel)
  @IsNotEmpty()
  billingModel!: PlanBillingModel;
 
  @IsNumber()
  @Min(0)
  basePrice!: number;
 
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency!: string;
 
  @IsEnum(PlanBillingCycle)
  @IsNotEmpty()
  billingCycle!: PlanBillingCycle;
 
  @IsString() @IsOptional() @MaxLength(50)
  storeType?: string;
 
  @IsInt() @IsOptional() @Min(0)
  includedStores?: number;
 
  @IsInt() @IsOptional() @Min(0)
  includedTerminals?: number;
 
  @IsNumber() @IsOptional() @Min(0)
  additionalTerminalPrice?: number;
 
  @IsInt() @IsOptional() @Min(0)
  includedEmployees?: number;
 
  @IsNumber() @IsOptional() @Min(0)
  additionalEmployeePrice?: number;
 
  @IsInt() @IsOptional() @Min(0)
  trialPeriod?: number;
 
  @IsISO8601() @IsOptional()
  effectiveFrom?: string | null;
 
  @IsArray() @IsString({ each: true }) @IsOptional()
  includedFeatures?: string[];
 
  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;
}
 
export class UpdatePlanDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
 
  @IsString()
  @IsOptional()
  description?: string;
 
  @IsEnum(PlanBillingModel)
  @IsOptional()
  billingModel?: PlanBillingModel;
 
  @IsNumber()
  @IsOptional()
  @Min(0)
  basePrice?: number;
 
  @IsString()
  @IsOptional()
  @MaxLength(3)
  currency?: string;
 
  @IsEnum(PlanBillingCycle)
  @IsOptional()
  billingCycle?: PlanBillingCycle;
 
  @IsString() @IsOptional() @MaxLength(50)
  storeType?: string | null;
 
  @IsInt() @IsOptional() @Min(0)
  includedStores?: number;
 
  @IsInt() @IsOptional() @Min(0)
  includedTerminals?: number;
 
  @IsNumber() @IsOptional() @Min(0)
  additionalTerminalPrice?: number;
 
  @IsInt() @IsOptional() @Min(0)
  includedEmployees?: number;
 
  @IsNumber() @IsOptional() @Min(0)
  additionalEmployeePrice?: number;
 
  @IsInt() @IsOptional() @Min(0)
  trialPeriod?: number;
 
  @IsISO8601() @IsOptional()
  effectiveFrom?: string | null;
 
  @IsArray() @IsString({ each: true }) @IsOptional()
  includedFeatures?: string[];
 
  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;
}