import { BadRequestException, CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { map, mergeMap } from 'rxjs';
import { MerchantRepository } from './merchant.repository';
import { MerchantResponseRelations } from './merchant-response-relations';
import { nationalPhone } from './countries';

function camelizeKeys(value: unknown, preserveSnakeKeys: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(value)) return value.map(item => camelizeKeys(item, preserveSnakeKeys));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const camelKey = preserveSnakeKeys.has(key)
      ? key
      : key.replace(/_([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
    result[camelKey] = camelizeKeys(child, preserveSnakeKeys);
  }
  return result;
}

function requireSnakeCaseKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(requireSnakeCaseKeys);
    return;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/[a-z][A-Z]/.test(key)) {
      throw new BadRequestException(`Use snake_case field '${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}' instead of '${key}'`);
    }
    requireSnakeCaseKeys(child);
  }
}

function snakeCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeCaseKeys);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source);
  const result: Record<string, unknown> = {};
  // Keep an existing snake_case key if the same field is also present in camelCase.
  for (const [key, child] of entries) {
    if (key.includes('_')) result[key] = snakeCaseKeys(child);
  }
  for (const [key, child] of entries) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (!(snakeKey in result)) result[snakeKey] = snakeCaseKeys(child);
  }
  return result;
}

function usesSnakeCaseContract(path: string): boolean {
  return /^(?:\/connector)?\/api\/v1\/(?:store-types\/[^/]+\/(?:features(?:\/by-category|\/bulk)?|role-templates(?:\/available)?)(?:\/|$)|permissions(?:\/|$)|role-templates(?:\/|$)|vendors(?:\/|$)|merchants(?:\/[^/]+\/vendors(?:\/(?:all|available))?|\/subscriptions(?:\/active)?|\/[^/]+)?|subscriptions(?:\/active)?|plans\/merchant-form|store-vendor-mappings(?:\/[^/]+)?|store\/store-pos-configuration\/[^/]+\/(?:currency_taxes|cashback_settings)(?:\/value)?|stores(?:\/[^/]+)?|merchants\/[^/]+\/stores(?:\/[^/]+)?|stores\/[^/]+\/pos\/(?:currency-tax|service-charges|cashback|opening-balance|cash-registers))\/?$/.test(path);
}

function shouldCamelizeBody(path: string): boolean {
  if (/^(?:\/connector)?\/api\/v1\/(?:stores(?:\/[^/]+)?|merchants\/[^/]+\/stores(?:\/[^/]+)?)\/?$/.test(path)) return false;
  return !/^(?:\/connector)?\/api\/v1\/(?:store-vendor-mappings|store\/store-pos-configuration\/)/.test(path);
}

function shouldCamelizeQuery(path: string): boolean {
  return !/^(?:\/connector)?\/api\/v1\/(?:store-vendor-mappings|store\/store-pos-configuration\/)/.test(path);
}

function attachMerchantCode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(attachMerchantCode);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) next[key] = attachMerchantCode(child);
  const merchantId = next.merchantId ?? next.merchant_id;
  if (typeof merchantId === 'string' && merchantId) next.merchant_code = merchantId;
  for (const key of ['phone', 'merchantPhoneNumber', 'phoneNumber']) {
    if (typeof next[key] === 'string' && !next[key].startsWith('+')) {
      next[key] = nationalPhone(next[key], next.country);
    }
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
    const request=context.switchToHttp().getRequest<{method?:string;path?:string;url?:string;body?:unknown;query?:Record<string, unknown>;user?:{id?:string;role?:string;agentMerchantIds?:string[];agentMerchantCodes?:string[];agentStoreIds?:string[]}}>();
    const path=(request.path || request.url || '').split('?')[0];
    const snakeCaseContract = usesSnakeCaseContract(path);
    if (snakeCaseContract) {
      requireSnakeCaseKeys(request.body);
      if (shouldCamelizeBody(path)) {
        const preserveSnakeKeys = /(?:^|\/)pos\/currency-tax\/?$/.test(path)
          ? new Set(['currency_symbol'])
          : new Set<string>();
        request.body = camelizeKeys(request.body, preserveSnakeKeys);
      }
      if (shouldCamelizeQuery(path) && request.query && typeof request.query === 'object') {
        requireSnakeCaseKeys(request.query);
        const normalizedQuery = camelizeKeys(request.query) as Record<string, unknown>;
        for (const key of Object.keys(request.query)) delete request.query[key];
        Object.assign(request.query, normalizedQuery);
      }
    }
    const compactSubscriptions = /^(?:\/connector)?\/api\/v1\/(?:subscriptions|merchants\/subscriptions)(?:\/|$)/.test(path);
    if (request.method === 'GET' && compactSubscriptions) {
      return next.handle().pipe(mergeMap(async payload => {
        const named = await featureNames(this.repository.requireDataSource(), payload);
        const response = this.filterAgent(request, attachMerchantCode(named));
        return snakeCaseContract ? snakeCaseKeys(response) : response;
      }));
    }
    const related=/^(?:\/connector)?\/api\/v1\/(?:merchants|subscriptions|subscription-plans|plans|stores|store-types|store_types|role-templates|role_templates|employees|devices|countries)(?:\/|$)/.test(path);
    if (!related && !snakeCaseContract) return this.scopeAgent(request, next.handle());
    return next.handle().pipe(mergeMap(async payload => {
      const expanded = request.method==='GET'
        ? await new MerchantResponseRelations(this.repository.requireDataSource()).expand(payload)
        : payload;
      const named = request.method==='GET' ? await featureNames(this.repository.requireDataSource(), expanded) : expanded;
      const response = this.filterAgent(request, attachMerchantCode(named));
      return snakeCaseContract ? snakeCaseKeys(response) : response;
    }));
  }

  private scopeAgent(request: {user?:{id?:string;role?:string;agentMerchantIds?:string[];agentMerchantCodes?:string[];agentStoreIds?:string[]}}, source: ReturnType<CallHandler['handle']>) {
    return source.pipe(map(payload => this.filterAgent(request, payload)));
  }

  private filterAgent(request: {user?:{id?:string;role?:string;agentMerchantIds?:string[];agentMerchantCodes?:string[];agentStoreIds?:string[]}}, payload: unknown): unknown {
    const user = request.user;
    if (!user || String(user.role || '').toUpperCase() !== 'AGENT') return payload;
    const responsePath = ((request as {path?:string;url?:string}).path || (request as {url?:string}).url || '').split('?')[0].replace(/^\/connector(?=\/)/, '');
    if ((request as {method?:string}).method === 'POST' && /^\/api\/v1\/merchants(?:\/create-merchant)?\/?$/.test(responsePath)) return payload;
    const merchants = new Set([...(user.agentMerchantIds || []), ...(user.agentMerchantCodes || [])].map(value => value.toLowerCase()));
    const stores = new Set((user.agentStoreIds || []).map(value => value.toLowerCase()));
    const ownership = (value: unknown): { marked: boolean; allowed: boolean } => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return { marked: false, allowed: false };
      const row = value as Record<string, unknown>;
      const ids = [row.merchantId,row.merchant_id,row.merchantCode,row.merchant_code,row.merchantUuid,row.merchant_uuid].filter((item): item is string => typeof item === 'string' && Boolean(item));
      if (ids.length) return { marked: true, allowed: ids.some(item => merchants.has(item.toLowerCase())) };
      const storeIds = [row.storeId,row.store_id,row.storeCode,row.store_code].filter((item): item is string => typeof item === 'string' && Boolean(item));
      if (storeIds.length) return { marked: true, allowed: storeIds.some(item => stores.has(item.toLowerCase())) };
      if (row.merchant && typeof row.merchant === 'object') return ownership(row.merchant);
      return { marked: false, allowed: false };
    };
    const walk = (value: unknown, inherited = false): unknown => {
      if (Array.isArray(value)) return value.flatMap(item => {
        const owner = ownership(item);
        if (owner.marked && !owner.allowed) return [];
        if (!owner.marked && !inherited) return [];
        return [walk(item, inherited || owner.allowed)];
      });
      if (!value || typeof value !== 'object' || value instanceof Date) return value;
      const owner = ownership(value);
      if (owner.marked && !owner.allowed) return null;
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) next[key] = walk(child, inherited || owner.allowed);
      return next;
    };
    const requestPath = (request as {path?:string;url?:string}).path || (request as {url?:string}).url || '';
    if (/^(?:\/connector)?\/api\/v1\/merchants\/(?!(?:subscriptions|countries|employees)(?:\/|$))[^/]+(?:\/|$)/.test(requestPath.split('?')[0])) return payload;
    if (/\/(?:plans|features|store-types|store_types|tenders|countries|role-templates|role_templates|permissions|feature-permissions)(?:\/|\?|$)/i.test(requestPath)) return payload;
    return walk(payload);
  }
}
