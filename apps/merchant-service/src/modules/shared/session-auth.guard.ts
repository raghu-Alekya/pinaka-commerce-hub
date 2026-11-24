import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { extractBearerToken, IS_PUBLIC_ROUTE, verifyAccessToken } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from '../merchant/merchant.repository';
import { ConsoleAccessService } from './console-access.service';
import { isWebConsoleRequest } from './console-access';

export const REQUIRE_AUTH_ROUTE = 'requireAuthRoute';
export const RequireAuth = () => SetMetadata(REQUIRE_AUTH_ROUTE, true);

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(ConsoleAccessService) private readonly consoleAccess: ConsoleAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ method?: string; path?: string; url?: string; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown>; headers?: { authorization?: string; 'x-pch-web-console'?: string }; user?: { id?: string; role?: string; agentMerchantIds?: string[]; agentMerchantCodes?: string[]; agentStoreIds?: string[]; [key: string]: unknown } }>();
    const requiresAuth = this.reflector?.getAllAndOverride<boolean>(REQUIRE_AUTH_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (process.env.SKIP_AUTH === 'true') {
      let bypassPayload: ReturnType<typeof verifyAccessToken> | null = null;
      if (request.headers?.authorization) {
        bypassPayload = verifyAccessToken(extractBearerToken(request.headers.authorization));
      }
      if (bypassPayload) {
        request.user = {
          id: bypassPayload.sub,
          accountId: bypassPayload.accountId,
          email: bypassPayload.email,
          role: bypassPayload.role,
          sessionId: bypassPayload.jti,
          accountType: bypassPayload.accountType,
          merchantId: bypassPayload.merchantId,
          merchantCode: bypassPayload.merchantCode,
          employeeId: bypassPayload.employeeId,
          storeId: bypassPayload.storeId,
          roleId: bypassPayload.roleId,
        };
        if (isWebConsoleRequest(request) && (bypassPayload.accountType === 'merchant' || bypassPayload.accountType === 'employee')) {
          await this.consoleAccess.assert(request as Parameters<ConsoleAccessService['assert']>[0]);
        } else if (isWebConsoleRequest(request)) {
          await this.assertPlatformAccount(request.user as { email?: string; role?: string });
        }
        await this.applyAgentScope(request);
        return true;
      }
      request.user = {
        id: '11111111-1111-4111-8111-111111111111',
        accountId: '11111111-1111-4111-8111-111111111111',
        email: 'admin@pinaka.com',
        role: 'OWNER',
        sessionId: 'session-skip-auth',
      };
      return true;
    }
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic && !requiresAuth) return true;
    const token = extractBearerToken(request.headers?.authorization);
    const payload = verifyAccessToken(token);
    const session = await this.merchants.touchSession(payload.jti!, token);
    if (!session) throw new UnauthorizedException('Session is not active. Please log in again.');
    const scopedPayload = payload as typeof payload & {
      merchantId?: string;
      storeId?: string;
    };
    request.user = {
      id: payload.sub,
      accountId: payload.accountId ?? session.accountId,
      email: payload.email ?? session.email,
      role: (payload as typeof payload & { roleCode?: string; roleName?: string }).roleName
        ?? (payload as typeof payload & { roleCode?: string }).roleCode
        ?? payload.role
        ?? session.role,
      deviceId: payload.deviceId,
      sessionId: session.id,
      merchantId: scopedPayload.merchantId ?? session.merchantId,
      storeId: scopedPayload.storeId ?? session.storeId,
      accountType: payload.accountType,
      employeeId: payload.employeeId,
      merchantCode: payload.merchantCode,
      roleId: payload.roleId,
    };
    if (isWebConsoleRequest(request) && (payload.accountType === 'merchant' || payload.accountType === 'employee')) {
      await this.consoleAccess.assert(request as Parameters<ConsoleAccessService['assert']>[0]);
    } else if (isWebConsoleRequest(request)) {
      await this.assertPlatformAccount(request.user as { email?: string; role?: string });
    }
    await this.applyAgentScope(request);
    return true;
  }

  private async applyAgentScope(request: { method?: string; path?: string; url?: string; params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown>; user?: { id?: string; role?: string; agentMerchantIds?: string[]; agentMerchantCodes?: string[]; agentStoreIds?: string[]; [key: string]: unknown } }) {
    if (String(request.user?.role || '').toUpperCase() !== 'AGENT') return;
    const method = String(request.method || '').toUpperCase();
    const rows = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id, COALESCE(to_jsonb(m)->>'merchant_code', to_jsonb(m)->>'merchantCode') AS code FROM public.merchants m WHERE to_jsonb(m)->>'agent_user_id'=$1`,
      [request.user?.id],
    );
    const ids = rows.map((row: { id: string }) => row.id);
    const codes = rows.map((row: { code?: string }) => row.code).filter((value: string | undefined): value is string => Boolean(value));
    const stores = ids.length
      ? await this.merchants.requireDataSource().query(`SELECT s.id::text AS id, COALESCE(to_jsonb(s)->>'store_code',to_jsonb(s)->>'storeCode') AS code FROM public.stores s
          WHERE COALESCE(to_jsonb(s)->>'merchant_id',to_jsonb(s)->>'merchantId')=ANY($1::text[])
            AND COALESCE((to_jsonb(s)->>'is_deleted')::boolean,false)=false`, [ids])
      : [];
    const storeIds = stores.flatMap((row: { id?: string; code?: string }) => [row.id, row.code]).filter((value: string | undefined): value is string => Boolean(value));
    request.user!.agentMerchantIds = ids;
    request.user!.agentMerchantCodes = codes;
    request.user!.agentStoreIds = storeIds;
    const allowedMerchantIds = new Set([...ids, ...codes].map(value => value.toLowerCase()));
    const allowedStoreIds = new Set(storeIds.map(value => value.toLowerCase()));
    const rawPath = (request.path || request.url || '').split('?')[0];
    const path = rawPath.split('/').filter(Boolean);
    const normalizedPath = rawPath.replace(/^\/connector(?=\/)/, '');
    const isCreateMerchant = method === 'POST' && /^\/api\/v1\/merchants(?:\/create-merchant)?\/?$/.test(normalizedPath);
    const isCreateStore = method === 'POST' && (/^\/api\/v1\/stores\/?$/.test(normalizedPath) || /^\/api\/v1\/merchants\/[^/]+\/stores(?:\/bulk)?\/?$/.test(normalizedPath));
    if (isCreateMerchant) return;
    if (isCreateStore) {
      const target = request.params?.merchantId || request.body?.merchantId || request.body?.merchant_id;
      if (!target || !allowedMerchantIds.has(String(target).toLowerCase())) throw new ForbiddenException('You can only create stores for merchants assigned to your account');
      return;
    }
    if (['PUT', 'PATCH'].includes(method) && /^\/api\/v1\/merchants\/[^/]+\/?$/.test(normalizedPath)) {
      const target = path[path.findIndex(part => part === 'merchants') + 1];
      if (!target || !allowedMerchantIds.has(target.toLowerCase())) throw new ForbiddenException('This merchant is not assigned to your account');
      return;
    }
    if (!['GET', 'OPTIONS'].includes(method)) throw new ForbiddenException('This action is not available to PCH agents');
    const merchantRoute = path.findIndex((part, index) => part === 'merchants' && index < path.length - 1);
    if (merchantRoute >= 0 && path[merchantRoute + 1] && !['subscriptions','countries','employees'].includes(path[merchantRoute + 1])) {
      const id = path[merchantRoute + 1].toLowerCase();
      if (!allowedMerchantIds.has(id)) throw new ForbiddenException('This merchant is not assigned to your account');
    }
    for (const key of ['merchantId', 'merchant_id']) {
      const id = request.query?.[key];
      if (id && !allowedMerchantIds.has(id.toLowerCase())) throw new ForbiddenException('This merchant is not assigned to your account');
    }
    for (const key of ['storeId', 'store_id']) {
      const id = request.query?.[key];
      if (id && !allowedStoreIds.has(id.toLowerCase())) throw new ForbiddenException('This store is not assigned to your account');
    }
  }

  private async assertPlatformAccount(user: { email?: string; role?: string }): Promise<void> {
    const role = String(user.role || '').toUpperCase();
    if (!['OWNER', 'ADMIN', 'SUPER_ADMIN', 'AGENT'].includes(role)) {
      throw new ForbiddenException('A merchant or administrator login is required');
    }
  }
}

export function requireOwnerRole(role?: string): void {
  if (role !== 'OWNER') {
    throw new ForbiddenException('Only owners may manage website connectors');
  }
}
