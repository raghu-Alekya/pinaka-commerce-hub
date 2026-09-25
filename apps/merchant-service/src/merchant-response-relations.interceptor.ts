import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { mergeMap } from 'rxjs';
import { MerchantRepository } from './merchant.repository';
import { MerchantResponseRelations } from './merchant-response-relations';
import { nationalPhone } from './countries';

function attachMerchantCode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(attachMerchantCode);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) next[key] = attachMerchantCode(child);
  const merchantId = next.merchantId ?? next.merchant_id;
  if (typeof merchantId === 'string' && merchantId) next.merchant_code = merchantId;
  for (const key of ['phone', 'merchantPhoneNumber', 'phoneNumber']) {
    if (typeof next[key] === 'string') next[key] = nationalPhone(next[key], next.country);
  }
  return next;
}

const featureId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function featureNames(db: { query: (sql: string, params?: unknown[]) => Promise<Array<{ id: string; name: string }>> }, payload: unknown) {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object' || value instanceof Date) return;
    const row = value as Record<string, unknown>;
    for (const key of ['included_features', 'includedFeatures', 'entitlements']) {
      const list = row[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) if (typeof item === 'string' && featureId.test(item)) ids.add(item);
    }
    Object.values(row).forEach(visit);
  };
  visit(payload);
  if (!ids.size) return payload;
  const rows = await db.query(`SELECT id::text AS id, name FROM public.features WHERE id = ANY($1::uuid[])`, [[...ids]]);
  const names = new Map(rows.map(row => [row.id.toLowerCase(), row.name]));
  const replace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const row = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(row)) {
      if (['included_features', 'includedFeatures', 'entitlements'].includes(key) && Array.isArray(child)) {
        next[key] = child.map(item => typeof item === 'string' && names.get(item.toLowerCase()) || item);
      } else next[key] = replace(child);
    }
    return next;
  };
  return replace(payload);
}

@Injectable()
export class MerchantResponseRelationsInterceptor implements NestInterceptor {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request=context.switchToHttp().getRequest<{method?:string;path?:string;url?:string}>();
    const path=(request.path || request.url || '').split('?')[0];
    const related=/^(?:\/connector)?\/api\/v1\/(?:merchants|subscriptions|subscription-plans|plans|stores|store-types|store_types|role-templates|role_templates|employees|devices|countries)(?:\/|$)/.test(path);
    if (!related) return next.handle();
    return next.handle().pipe(mergeMap(async payload => {
      const expanded = request.method==='GET'
        ? await new MerchantResponseRelations(this.repository.requireDataSource()).expand(payload)
        : payload;
      const named = request.method==='GET' ? await featureNames(this.repository.requireDataSource(), expanded) : expanded;
      return attachMerchantCode(named);
    }));
  }
}
