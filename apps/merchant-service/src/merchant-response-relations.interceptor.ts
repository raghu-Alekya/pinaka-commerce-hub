import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { mergeMap } from 'rxjs';
import { MerchantRepository } from './merchant.repository';
import { MerchantResponseRelations } from './merchant-response-relations';

function attachMerchantCode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(attachMerchantCode);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) next[key] = attachMerchantCode(child);
  const merchantId = next.merchantId ?? next.merchant_id;
  if (typeof merchantId === 'string' && merchantId) next.merchant_code = merchantId;
  return next;
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
      return attachMerchantCode(expanded);
    }));
  }
}
