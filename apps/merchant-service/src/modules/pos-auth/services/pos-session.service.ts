import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

export interface CreateSessionParams {
  employeeId: string;
  merchantId: string;
  storeId: string;
  deviceId: string;
  registerId?: string;
  roleId: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signatureInput}.${signature}`;
}

@Injectable()
export class PosSessionService {
  private get secret(): string {
    return process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || 'pdh-local-development-secret-change-me';
  }

  async createSession(params: CreateSessionParams) {
    const now = Math.floor(Date.now() / 1000);
    const sessionId = `sess_${now}_${Math.random().toString(36).substring(2, 8)}`;

    const accessPayload = {
      sub: params.employeeId,
      jti: sessionId,
      sid: sessionId,
      type: 'access',
      merchantId: params.merchantId,
      storeId: params.storeId,
      deviceId: params.deviceId,
      registerId: params.registerId || 'REG-01',
      roleId: params.roleId,
      iat: now,
      exp: now + 12 * 3600,
    };

    const refreshPayload = {
      jti: `ref_${sessionId}`,
      sid: sessionId,
      sub: params.employeeId,
      type: 'refresh',
      iat: now,
      exp: now + 7 * 24 * 3600,
    };

    const accessToken = signJwt(accessPayload, this.secret);
    const refreshToken = signJwt(refreshPayload, this.secret);

    return {
      sessionId,
      accessToken,
      refreshToken,
    };
  }
}
