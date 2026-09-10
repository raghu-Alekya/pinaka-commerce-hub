import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { extractBearerToken, IS_PUBLIC_ROUTE, verifyAccessToken } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.SKIP_AUTH === 'true') return true;
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string }; user?: unknown }>();
    const token = extractBearerToken(request.headers?.authorization);
    const payload = verifyAccessToken(token);
    const session = await this.merchants.touchSession(payload.jti!, token);
    if (!session) throw new UnauthorizedException('Session is not active. Please log in again.');
    request.user = {
      id: payload.sub,
      accountId: payload.accountId ?? session.accountId,
      email: payload.email ?? session.email,
      role: payload.role ?? session.role,
      sessionId: session.id,
    };
    return true;
  }
}

export function requireOwnerRole(role?: string): void {
  if (role !== 'OWNER') {
    throw new ForbiddenException('Only owners may manage website connectors');
  }
}
