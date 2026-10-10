import { ArgumentMetadata, BadRequestException, ValidationPipe, CanActivate, ExecutionContext, Injectable, UnauthorizedException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PlanRepository } from './plan.repository';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { extractBearerToken, verifyAccessToken } from '@pinaka-delivery-hub/auth';

class PlanSchemaDto {
  @ValidateIf((_, value) => value !== undefined) @IsString() description?: string;
  @ValidateIf((_, value) => value !== undefined) @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['FLAT', 'PER_STORE', 'PER_DEVICE', 'CUSTOM']) billing_model?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) base_price?: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @ValidateIf((_, value) => value !== undefined)
  @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['MONTHLY', 'QUARTERLY', 'ANNUAL']) billing_cycle?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID() store_type_id?: string | null;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) stores_limit?: number;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) terminal_limit?: number;
  @ValidateIf((_, value) => value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) additional_terminal_price?: number;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) employees_limit?: number;
  @ValidateIf((_, value) => value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) additional_employee_price?: number;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) trial_period?: number;
  @ValidateIf((_, value) => value !== undefined && value !== null) @IsISO8601() effective_from?: string | null;
  @ValidateIf((_, value) => value !== undefined) @IsArray() @IsString({ each: true }) included_features?: string[];
  @ValidateIf((_, value) => value !== undefined && value !== null) @IsISO8601() plan_end_date?: string | null;
}

const aliases: Record<string, Record<string, string>> = {
  PlanSchemaDto: {
    code: 'plan_code',
    price: 'base_price',
    cycle: 'billing_cycle',
    planCode: 'plan_code',
    billingModel: 'billing_model',
    basePrice: 'base_price',
    billingCycle: 'billing_cycle',
    includedStores: 'stores_limit',
    includedTerminals: 'terminal_limit',
    includedEmployees: 'employees_limit',
    additionalTerminalPrice: 'additional_terminal_price',
    additionalEmployeePrice: 'additional_employee_price',
    trialPeriod: 'trial_period',
    effectiveFrom: 'effective_from',
    includedFeatures: 'included_features',
    storeTypeId: 'store_type_id',
    storesLimit: 'stores_limit',
    terminalLimit: 'terminal_limit',
    employeesLimit: 'employees_limit',
    included_stores: 'stores_limit',
    included_terminals: 'terminal_limit',
    included_employees: 'employees_limit',
    planEndDate: 'plan_end_date',
    createdBy: 'created_by',
    updatedBy: 'updated_by',
    isDeleted: 'is_deleted',
  },
};
function normalizePlanForm(body: unknown, dto: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const values = { ...body } as Record<string, unknown>;
  for (const [alias, canonical] of Object.entries(aliases[dto] || {})) {
    if (!(alias in values)) continue;
    if (canonical in values && values[canonical] !== values[alias]) {
      throw new BadRequestException(`Supply either ${alias} or ${canonical}, not conflicting values`);
    }
    values[canonical] = values[alias];
    delete values[alias];
  }
  for (const key of ['status', 'billing_model', 'billing_cycle']) {
    if (typeof values[key] === 'string') {
      values[key] = (values[key] as string).trim().toUpperCase().replace(/\s+/g, '_');
    }
  }
  if (values.billing_model === 'FLAT_RATE') values.billing_model = 'FLAT';
  if (values.billing_cycle === 'YEARLY') values.billing_cycle = 'ANNUAL';
  if (dto === 'PlanSchemaDto') {
    for (const key of [
      'base_price', 'stores_limit', 'terminal_limit', 'additional_terminal_price',
      'employees_limit', 'additional_employee_price', 'trial_period',
    ]) {
      if (typeof values[key] === 'string' && values[key].trim() !== '') values[key] = Number(values[key]);
    }
  }
  return values;
}

class PlanFormValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(normalizePlanForm(value, this.expectedType?.name || ''), metadata);
  }
}

function filterPlans<T extends object>(items: T[], query: Record<string, string> = {}): T[] {
  for (const key of ['status', 'billingModel', 'billing_model', 'category', 'search']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') {
      throw new BadRequestException(`${key} must be a single string`);
    }
  }
  const status = query.status?.trim().toUpperCase();
  if (status && !['ACTIVE', 'INACTIVE', 'ALL STATUSES'].includes(status)) {
    throw new BadRequestException('Invalid status');
  }
  const billingModel = (query.billing_model ?? query.billingModel)?.trim().toUpperCase().replace(/\s+/g, '_').replace(/^FLAT_RATE$/, 'FLAT');
  if (billingModel && !['PER_STORE', 'PER_DEVICE', 'FLAT', 'CUSTOM'].includes(billingModel)) {
    throw new BadRequestException('Invalid billingModel');
  }
  const search = query.search?.trim().toLowerCase();
  return items.filter((item) => {
    const row = item as Record<string, unknown>;
    return (!status || status === 'ALL STATUSES' || row.status === status)
      && (!query.category || query.category === 'All Categories' || row.category === query.category)
      && (!billingModel || (row.billing_model ?? row.billingModel) === billingModel)
      && (!search || ['name', 'description', 'category', 'featureKey', 'storeTypeCode', 'roleCode', 'planCode', 'plan_code']
        .some((key) => String(row[key] ?? '').toLowerCase().includes(search)));
  });
}

@Injectable()
export class PlanWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; planUserId?: string }>();
    const payload = verifyAccessToken(extractBearerToken(request.headers.authorization));
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)) {
      throw new UnauthorizedException('Access token must identify a valid user');
    }
    request.planUserId = payload.sub;
    return true;
  }
}

const defined = (body: object) => Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
const validate = (expectedType: typeof PlanSchemaDto, patch = false) => new PlanFormValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, skipUndefinedProperties: patch });

@Controller(['api/v1/plans', 'connector/api/v1/plans', 'plans'])
export class PlanController {
  constructor(@Inject(PlanRepository) private readonly repository: PlanRepository) {}
  @Get()
  async list(@Query() query: Record<string, string>) {
    const plans = filterPlans(await this.repository.execute('list'), query);
    return { success: true, count: plans.length, plans };
  }
  @Get('merchant-form')
  async merchantFormPlans() {
    const plans = await this.repository.listActiveForMerchant();
    const grouped = new Map<string, { storeType: Record<string, any> | null; plans: Array<Record<string, any>> }>();
    for (const plan of plans) {
      const storeType = plan.storeType && typeof plan.storeType === 'object'
        ? plan.storeType as Record<string, any>
        : null;
      const key = String(storeType?.id || plan.storeTypeId);
      const group = grouped.get(key) || { storeType, plans: [] as Array<Record<string, any>> };
      group.plans.push(plan);
      grouped.set(key, group);
    }
    return { success: true, count: plans.length, planGroups: [...grouped.values()] };
  }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) { return { success: true, plan: await this.repository.execute('get', id) }; }
  @Post() @UseGuards(PlanWriteGuard) async create(@Req() request: { planUserId: string }, @Body(validate(PlanSchemaDto)) body: PlanSchemaDto | Record<string, unknown>) { return { success: true, plan: await this.repository.execute('create', undefined, defined(body), request.planUserId) }; }
  @Put(':id') @UseGuards(PlanWriteGuard) async replace(@Req() request: { planUserId: string }, @Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanSchemaDto)) body: PlanSchemaDto | Record<string, unknown>) { return { success: true, plan: await this.repository.execute('update', id, defined(body), request.planUserId) }; }
  @Patch(':id') @UseGuards(PlanWriteGuard) async patch(@Req() request: { planUserId: string }, @Param('id', new ParseUUIDPipe()) id: string, @Body(validate(PlanSchemaDto, true)) body: PlanSchemaDto | Record<string, unknown>) { return { success: true, plan: await this.repository.execute('update', id, defined(body), request.planUserId) }; }
  @Delete(':id') @UseGuards(PlanWriteGuard) async remove(@Req() request: { planUserId: string }, @Param('id', new ParseUUIDPipe()) id: string) { await this.repository.execute('delete', id, {}, request.planUserId); return { success: true, message: 'Plan soft-deleted', is_deleted: true }; }
}
