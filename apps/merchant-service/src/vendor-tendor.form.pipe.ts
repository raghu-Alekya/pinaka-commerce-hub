import { ArgumentMetadata, BadRequestException, PipeTransform, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

const vendorAliases: Record<string, string> = {
  name: 'vendorName',
  type: 'vendorType',
  code: 'vendorCode',
  contact: 'contactPerson',
  product: 'productCategory',
  category: 'productCategory',
};

const tendorAliases: Record<string, string> = {
  name: 'tendorName',
  code: 'tendorCode',
  tenderName: 'tendorName',
  tenderCode: 'tendorCode',
  tendor_Name: 'tendorName',
  tendor_name: 'tendorName',
  tendor_code: 'tendorCode',
};

function applyAliases(body: Record<string, unknown>, aliases: Record<string, string>): void {
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in body)) continue;
    if (canonical in body && body[canonical] !== body[alias]) {
      throw new BadRequestException(`Supply either ${alias} or ${canonical}, not conflicting values`);
    }
    body[canonical] = body[alias];
    delete body[alias];
  }
}

function camelizeSnakeCaseKeys(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!key.includes('_')) continue;
    const camel = key.replace(/_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase()).replace(/_/g, '');
    if (camel === key) continue;
    if (camel in body && body[camel] !== body[key]) {
      throw new BadRequestException(`Supply either ${key} or ${camel}, not conflicting values`);
    }
    body[camel] = body[key];
    delete body[key];
  }
}

function asPlainObject(body: unknown): Record<string, unknown> | unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { ...(body as Record<string, unknown>) };
}

export function normalizeVendorForm(body: unknown): unknown {
  const values = asPlainObject(body);
  if (!values || typeof values !== 'object') return body;
  applyAliases(values as Record<string, unknown>, vendorAliases);
  return values;
}

export function normalizeTendorForm(body: unknown): unknown {
  const values = asPlainObject(body);
  if (!values || typeof values !== 'object') return body;
  camelizeSnakeCaseKeys(values as Record<string, unknown>);
  applyAliases(values as Record<string, unknown>, tendorAliases);
  return values;
}

export class VendorFormValidationPipe implements PipeTransform {
  private readonly validator: ValidationPipe;

  constructor(options: ValidationPipeOptions) {
    this.validator = new ValidationPipe(options);
  }

  transform(value: unknown, metadata: ArgumentMetadata) {
    return this.validator.transform(normalizeVendorForm(value) as object, metadata);
  }
}

export class TendorFormValidationPipe implements PipeTransform {
  private readonly validator: ValidationPipe;

  constructor(options: ValidationPipeOptions) {
    this.validator = new ValidationPipe(options);
  }

  transform(value: unknown, metadata: ArgumentMetadata) {
    return this.validator.transform(normalizeTendorForm(value) as object, metadata);
  }
}
