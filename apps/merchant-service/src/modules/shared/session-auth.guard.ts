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
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string; 'x-pch-web-console'?: string }; user?: unknown }>();
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
    return true;
  }

  private async assertPlatformAccount(user: { email?: string; role?: string }): Promise<void> {
    const role = String(user.role || '').toUpperCase();
    if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      throw new ForbiddenException('A merchant or administrator login is required');
    }
  }
}

export function requireOwnerRole(role?: string): void {
  if (role !== 'OWNER') {
    throw new ForbiddenException('Only owners may manage website connectors');
  }
}
