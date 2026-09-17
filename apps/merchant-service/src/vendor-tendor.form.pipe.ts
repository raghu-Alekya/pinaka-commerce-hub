import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

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
  tenderName: 'tendorName',
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

export function normalizeVendorForm(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const values = { ...body } as Record<string, unknown>;
  applyAliases(values, vendorAliases);
  return values;
}

export function normalizeTendorForm(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const values = { ...body } as Record<string, unknown>;
  applyAliases(values, tendorAliases);
  return values;
}

export class VendorFormValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(normalizeVendorForm(value), metadata);
  }
}

export class TendorFormValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(normalizeTendorForm(value), metadata);
  }
}
