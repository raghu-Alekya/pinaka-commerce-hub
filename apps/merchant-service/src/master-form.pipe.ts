import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

const aliases: Record<string, Record<string, string>> = {
  StoreTypeDto: { code: 'storeTypeCode' },
  FeatureDto: { type: 'featureType' },
  RoleTemplateDto: { key: 'roleCode', scope: 'scopeType' },
  PlanDto: { code: 'planCode', price: 'basePrice', cycle: 'billingCycle' },
};

/** Accept form labels at the HTTP boundary; persistence retains the API schema. */
export function normalizeMasterForm(body: unknown, dto: string): unknown {
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
  for (const key of ['status', 'featureType', 'scopeType', 'billingModel', 'billingCycle']) {
    if (typeof values[key] === 'string') {
      values[key] = (values[key] as string).trim().toUpperCase().replace(/\s+/g, '_');
    }
  }
  if (values.billingModel === 'FLAT_RATE') values.billingModel = 'FLAT';
  if (values.billingCycle === 'YEARLY') values.billingCycle = 'ANNUAL';
  if (dto === 'PlanDto' && typeof values.basePrice === 'string' && values.basePrice.trim() !== '') {
    values.basePrice = Number(values.basePrice);
  }
  return values;
}

export class MasterFormValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(normalizeMasterForm(value, this.expectedType?.name || ''), metadata);
  }
}
