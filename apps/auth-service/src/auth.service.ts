import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import {
  CompletePasswordActionDto,
  CreateAccountDto,
  GoogleLoginDto,
  LoginDto,
  RefreshTokenDto,
  SignUpDto,
} from './auth.dto';
import { MailService } from './mail.service';
import { CreateUserDto } from './user.dto';
import { UserEntity, UserRole, UserStatus } from './user.entity';
import { UserRepository } from './user.repository';

const scrypt = promisify(scryptCallback);
const TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  async signUp(dto: SignUpDto) {
    const { account, user } = await this.users.createAccountOwnerFromSignUp(
      dto.email,
      await this.hashPassword(dto.password),
    );
    return { ...(await this.createSession(user)), account };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await this.verifyPassword(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.createSession(user);
  }

  async loginWithGoogle(dto: GoogleLoginDto) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId)
      throw new InternalServerErrorException(
        'GOOGLE_CLIENT_ID is not configured',
      );
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.credential)}`,
    );
    if (!response.ok)
      throw new UnauthorizedException('Invalid Google credential');
    const profile = (await response.json()) as {
      aud?: string;
      email?: string;
      email_verified?: string;
      given_name?: string;
      family_name?: string;
    };
    if (
      profile.aud !== clientId ||
      profile.email_verified !== 'true' ||
      !profile.email
    ) {
      throw new UnauthorizedException('Invalid Google credential');
    }
    const email = profile.email.trim().toLowerCase();
    const user =
      (await this.users.findByEmail(email)) ??
      (await this.users.createGoogleUser(
        email,
        profile.given_name || email.split('@')[0] || 'User',
        profile.family_name || '',
      ));
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Account is not active');
    return this.createSession(user);
  }

  async inviteUser(dto: CreateUserDto, accountId: string | null = null) {
    const { token, hash, expiresAt } = this.createActionToken(86400);
    const user = await this.users.createInvitedUser(
      dto,
      accountId,
      hash,
      expiresAt,
    );
    await this.mail.sendInvitation(
      user.email,
      user.firstName,
      this.actionUrl('accept-invitation', token),
    );
    return this.toPublicUser(user);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const { token, hash, expiresAt } = this.createActionToken(3600);
    await this.users.setActionToken(user.id, hash, 'RESET', expiresAt);
    await this.mail.sendPasswordReset(
      user.email,
      this.actionUrl('reset-password', token),
    );
  }

  async completePasswordAction(
    dto: CompletePasswordActionDto,
    type: 'INVITE' | 'RESET',
  ) {
    const user = await this.users.findByActionToken(
      this.hashToken(dto.token),
      type,
    );
    if (
      !user?.actionTokenExpiresAt ||
      user.actionTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('The link is invalid or has expired');
    }
    return this.createSession(
      await this.users.activateWithPassword(
        user,
        await this.hashPassword(dto.password),
      ),
    );
  }

  async createPosAccount(dto: CreateAccountDto) {
    const account = await this.users.createAccount(dto.account_name);
    const accountManager = await this.inviteUser(
      {
        firstName: dto.account_manager_firstname,
        lastName: dto.account_manager_lastname,
        email: dto.account_manager_email,
        phoneNumber: dto.account_manager_phone,
        role: UserRole.OWNER,
        notificationEnabled: true,
      },
      account.id,
    );
    return { account, accountManager };
  }

  async refresh(dto: RefreshTokenDto) {
    const payload = this.verifyRefreshToken(dto.refreshToken);
    const tokenId = typeof payload.jti === 'string' ? payload.jti : '';
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    if (!tokenId || !userId || payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const stored = await this.users.findActiveRefreshToken(tokenId);
    if (
      !stored ||
      stored.userId !== userId ||
      stored.tokenHash !== this.hashToken(dto.refreshToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.users.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const session = await this.createSession(user);
    await this.users.revokeRefreshToken(tokenId, session.refreshTokenId);
    const { refreshTokenId: _refreshTokenId, ...result } = session;
    return result;
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    const payload = this.verifyRefreshToken(dto.refreshToken);
    const tokenId = typeof payload.jti === 'string' ? payload.jti : '';
    if (tokenId) await this.users.revokeRefreshToken(tokenId);
  }

  async requireAccountOwner(authorization?: string): Promise<UserEntity> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer token is required');
    const payload = this.verifyToken(token);
    const user = await this.users.findById(String(payload.sub));
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid access token');
    }
    if (user.role !== UserRole.OWNER || !user.accountId) {
      throw new ForbiddenException('Only account owners can manage users');
    }
    return user;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt.toString('base64url')}:${key.toString('base64url')}`;
  }

  private async verifyPassword(
    password: string,
    storedHash: string,
  ): Promise<boolean> {
    const [saltValue, hashValue] = storedHash.split(':');
    if (!saltValue || !hashValue) return false;
    try {
      const expected = Buffer.from(hashValue, 'base64url');
      const actual = (await scrypt(
        password,
        Buffer.from(saltValue, 'base64url'),
        expected.length,
      )) as Buffer;
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    } catch {
      return false;
    }
  }

  private async createSession(user: UserEntity) {
    const now = Math.floor(Date.now() / 1000);
    const accessPayload = {
      sub: user.id,
      accountId: user.accountId ?? null,
      email: user.email,
      role: user.role,
      type: 'access',
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
    };
    const refreshTokenId = randomUUID();
    const refreshToken = this.signRefreshToken({
      sub: user.id,
      jti: refreshTokenId,
      type: 'refresh',
      iat: now,
      exp: now + REFRESH_TOKEN_LIFETIME_SECONDS,
    });
    await this.users.createRefreshToken({
      id: refreshTokenId,
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date((now + REFRESH_TOKEN_LIFETIME_SECONDS) * 1000),
    });
    return {
      accessToken: this.signToken(accessPayload),
      refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_LIFETIME_SECONDS,
      tokenType: 'Bearer',
      expiresIn: TOKEN_LIFETIME_SECONDS,
      user: this.toPublicUser(user),
      refreshTokenId,
    };
  }

  private createActionToken(lifetimeSeconds: number) {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashToken(token),
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private actionUrl(path: string, token: string): string {
    const base = (process.env.AUTH_WEB_URL || 'http://localhost:3010').replace(
      /\/$/,
      '',
    );
    return `${base}/${path}?token=${encodeURIComponent(token)}`;
  }

  private signToken(payload: Record<string, unknown>): string {
    return this.signTokenWithSecret(payload, this.jwtSecret());
  }

  private signRefreshToken(payload: Record<string, unknown>): string {
    return this.signTokenWithSecret(payload, this.refreshJwtSecret());
  }

  private signTokenWithSecret(
    payload: Record<string, unknown>,
    secret: string,
  ): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac(
      'sha256',
      secret,
    )
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  private verifyToken(token: string): Record<string, unknown> {
    return this.verifyTokenWithSecret(token, this.jwtSecret(), 'access token');
  }

  private verifyRefreshToken(token: string): Record<string, unknown> {
    return this.verifyTokenWithSecret(token, this.refreshJwtSecret(), 'refresh token');
  }

  private verifyTokenWithSecret(
    token: string,
    secret: string,
    label: string,
  ): Record<string, unknown> {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature)
      throw new UnauthorizedException(`Invalid ${label}`);
    const expected = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new UnauthorizedException(`Invalid ${label}`);
    }
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        typeof payload.exp !== 'number' ||
        payload.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new UnauthorizedException(`${label} has expired`);
      }
      return payload;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(`Invalid ${label}`);
    }
  }

  private jwtSecret(): string {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'AUTH_JWT_SECRET is not configured',
      );
    }
    return secret || 'pdh-local-development-secret-change-me';
  }

  private refreshJwtSecret(): string {
    const secret = process.env.AUTH_REFRESH_JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'AUTH_REFRESH_JWT_SECRET is not configured',
      );
    }
    return secret || 'pdh-local-development-refresh-secret-change-me';
  }

  private toPublicUser(user: UserEntity) {
    const {
      passwordHash: _passwordHash,
      actionTokenHash: _actionTokenHash,
      actionTokenType: _actionTokenType,
      actionTokenExpiresAt: _actionTokenExpiresAt,
      ...publicUser
    } = user;
    return publicUser;
  }
}
