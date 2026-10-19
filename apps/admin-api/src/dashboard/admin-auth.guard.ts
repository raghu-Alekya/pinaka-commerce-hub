import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  extractBearerToken,
  verifyAccessToken,
} from '@pinaka-delivery-hub/auth';
import { AdminDatabase } from './database.provider';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminDatabase) private readonly db: AdminDatabase) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      user?: unknown;
    }>();

    if (process.env.SKIP_AUTH === 'true' && !request.headers?.authorization) {
      request.user = { id: 'skip-auth', role: 'OWNER' };
      return true;
    }

    const token = extractBearerToken(request.headers?.authorization);
    const payload = verifyAccessToken(token);
    await this.assertActiveSession(payload.jti!, token);
    request.user = {
      id: payload.sub,
      accountId: payload.accountId,
      email: payload.email,
      role: payload.role,
      sessionId: payload.jti,
    };
    return true;
  }

  private async assertActiveSession(
    sessionId: string,
    accessToken: string,
  ): Promise<void> {
    const accessTokenHash = createHash('sha256')
      .update(accessToken)
      .digest('hex');
    const rows = await this.db.query(
      `SELECT id
         FROM public.sessions
        WHERE id = $1
          AND "revokedAt" IS NULL
          AND "expiresAt" > NOW()
          AND "accessTokenHash" = $2
        LIMIT 1`,
      [sessionId, accessTokenHash],
    );
    if (!rows.length) {
      throw new UnauthorizedException(
        'Session is not active. Please log in again.',
      );
    }
  }
}
