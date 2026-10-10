export function toSnakeCaseResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnakeCaseResponse);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
    toSnakeCaseResponse(item),
  ]));
}

export function permissionRequestToInternal(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  if ('feature_id' in result) {
    result.featureId = result.feature_id;
    delete result.feature_id;
  }
  if ('permission_key' in result) {
    result.permissionKey = result.permission_key;
    delete result.permission_key;
  }
  if ('permission_code' in result) {
    result.permissionCode = result.permission_code;
    delete result.permission_code;
  }
  if ('permission_type' in result) {
    result.permissionType = result.permission_type;
    delete result.permission_type;
  }
  return result;
}

export function parsePage(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException(`${name} must be a positive integer`);
  return parsed;
}

import { BadRequestException } from '@nestjs/common';

