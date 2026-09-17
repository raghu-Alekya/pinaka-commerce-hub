import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
 
const aliases: Record<string, Record<string, string>> = {
  StoreTypeDto: { code: 'storeTypeCode' },
  CreateStoreTypeDto: { code: 'storeTypeCode' },
  UpdateStoreTypeDto: { code: 'storeTypeCode' },
  FeatureDto: { type: 'featureType' },
  RoleTemplateDto: { key: 'roleCode', scope: 'scopeType' },
  PlanDto: {
    code: 'planCode', price: 'basePrice', cycle: 'billingCycle',
    store_type: 'storeType', included_stores: 'includedStores', included_terminals: 'includedTerminals',
    additional_terminal_price: 'additionalTerminalPrice', included_employees: 'includedEmployees',
    additional_employee_price: 'additionalEmployeePrice', trial_period: 'trialPeriod',
    effective_from: 'effectiveFrom', included_features: 'includedFeatures',
  },
};
 
/** Accept form labels at the HTTP boundary; persistence retains the API schema. */
export function normalizeMasterForm(body: unknown, dto: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const values = { ...body } as Record<string, unknown>;
  // The Features screen uses Name as its unique feature key.
  if (dto === 'FeatureDto' && 'type' in values && !('featureKey' in values) && 'name' in values) {
    values.featureKey = values.name;
  }
  for (const [alias, canonical] of Object.entries(aliases[dto] || {})) {
    if (!(alias in values)) continue;
    if (canonical in values && values[canonical] !== values[alias]) {
      throw new BadRequestException(`Supply either ${alias} or ${canonical}, not conflicting values`);
    }
    values[canonical] = values[alias];
    delete values[alias];
  }
  for (const key of ['status', 'featureType', 'scopeType', 'billingModel', 'billingCycle', 'storeType']) {
    if (typeof values[key] === 'string') {
      values[key] = (values[key] as string).trim().toUpperCase().replace(/\s+/g, '_');
    }
  }
  if (values.billingModel === 'FLAT_RATE') values.billingModel = 'FLAT';
  if (values.billingCycle === 'YEARLY') values.billingCycle = 'ANNUAL';
  if (dto === 'PlanDto') {
    for (const key of [
      'basePrice', 'includedStores', 'includedTerminals', 'additionalTerminalPrice',
      'includedEmployees', 'additionalEmployeePrice', 'trialPeriod',
    ]) {
      if (typeof values[key] === 'string' && values[key].trim() !== '') values[key] = Number(values[key]);
    }
  }
  return values;
}
 
export class MasterFormValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(normalizeMasterForm(value, this.expectedType?.name || ''), metadata);
  }
}