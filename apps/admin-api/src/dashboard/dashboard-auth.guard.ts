import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { extractBearerToken, verifyAccessToken } from '@pinaka-delivery-hub/auth';

type DashboardRequest = {
  headers?: { authorization?: string };
  user?: Record<string, unknown>;
};

const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'SUPERADMIN',
  'ADMIN',
  'ADMINISTRATOR',
  'OWNER',
]);

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<DashboardRequest>();
    const token = extractBearerToken(request.headers?.authorization);
    const payload = verifyAccessToken(token);
    const role = String(payload.role || '').trim().toUpperCase();

    if (!ADMIN_ROLES.has(role)) {
      throw new ForbiddenException('An administrator account is required');
    }

    // Preserve the verified identity so future merchant scoping can use token claims.
    request.user = payload as unknown as Record<string, unknown>;
    return true;
  }
}
