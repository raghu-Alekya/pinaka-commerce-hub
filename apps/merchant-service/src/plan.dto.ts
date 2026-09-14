import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, MaxLength } from 'class-validator';
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

  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;
}
